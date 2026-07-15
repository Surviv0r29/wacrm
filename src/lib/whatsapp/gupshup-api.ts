/**
 * Gupshup messaging — Self-Serve WA API first, then Partner fallbacks.
 *
 * Self-Serve: https://api.gupshup.io/wa/api/v1/msg (and /template/msg)
 * Partner:    https://partner.gupshup.io/partner/app/{appId}/… 
 *
 * DigiGlobal and many Self-Serve apps accept `sk_` as the Self-Serve `apikey`
 * header. Partner `/v3/message` and `/template/msg` often return
 * "Please review the request parameters" for those same apps.
 */

import {
  isLikelyGupshupAppId,
  normalizeGupshupApiToken,
  pickGupshupSelfServeApiKey,
} from '@/lib/whatsapp/gupshup-auth'
import {
  buildSendComponents,
  type SendTimeParams,
} from '@/lib/whatsapp/template-send-builder'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import type { MessageTemplate } from '@/types'

const GUPSHUP_PARTNER_BASE =
  process.env.GUPSHUP_PARTNER_API_BASE ?? 'https://partner.gupshup.io'

const GUPSHUP_WA_API_BASE =
  process.env.GUPSHUP_WA_API_BASE ?? 'https://api.gupshup.io'

export interface GupshupSendResult {
  messageId: string
}

export type GupshupMediaKind = 'image' | 'video' | 'document' | 'audio'

/** Extra fields required for Self-Serve WA API fallback. */
export interface GupshupSelfServeContext {
  /** Business WhatsApp number (digits only, with country code). */
  sourcePhone?: string | null
  /** App display name shown in Gupshup Console (src.name). */
  appName?: string | null
  /**
   * `apikey` for https://api.gupshup.io/wa/api/...
   * Console hex key preferred; Partner `sk_` also works for many Self-Serve apps.
   */
  apiKey?: string | null
}

interface GupshupErrorResponse {
  message?: string
  status?: string
  messageId?: string
  error?: { message?: string; code?: number | string }
  errors?: Array<{ message?: string; code?: number | string }>
  messages?: { id?: string }[]
}

function extractGupshupErrorMessage(
  data: GupshupErrorResponse,
  fallback: string,
): string {
  const parts: string[] = []
  if (data.message) parts.push(data.message)
  if (data.error?.message && data.error.message !== data.message) {
    parts.push(data.error.message)
  }
  if (data.error?.code) parts.push(`code ${data.error.code}`)
  for (const err of data.errors ?? []) {
    if (err.message) parts.push(err.message)
    if (err.code) parts.push(`code ${err.code}`)
  }
  return parts.length ? parts.join(' — ') : fallback
}

function isParamReviewError(message: string): boolean {
  return /review the request parameters|required parameter|invalid app details/i.test(
    message,
  )
}

function toFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') {
      params.set(key, JSON.stringify(value))
    } else {
      params.set(key, String(value))
    }
  }
  return params
}

function digitsOnly(value: string): string {
  return String(value).replace(/\D/g, '')
}

/** Gupshup V3 examples use short codes (`en`); DB may store `en_US`. */
function normalizeGupshupTemplateLanguage(language: string): string {
  const code = language.trim().replace('-', '_')
  if (!code) return 'en'
  const [base, region] = code.split('_')
  if (!region) return base.toLowerCase()
  if (base.toLowerCase() === 'en') return 'en'
  return `${base.toLowerCase()}_${region.toUpperCase()}`
}

/** Resolve Self-Serve context from args + platform env overrides. */
export function resolveGupshupSelfServeContext(
  ctx?: GupshupSelfServeContext | null,
): GupshupSelfServeContext | null {
  const sourcePhone =
    ctx?.sourcePhone?.trim() ||
    process.env.GUPSHUP_SOURCE_PHONE?.trim() ||
    null
  const appName =
    ctx?.appName?.trim() ||
    process.env.GUPSHUP_APP_NAME?.trim() ||
    null
  if (!sourcePhone || !appName) return null
  const apiKey = pickGupshupSelfServeApiKey({
    storedToken: ctx?.apiKey,
    partnerAppToken: null,
  })
  return { sourcePhone, appName, apiKey }
}

/**
 * Self-Serve `/wa/api/v1/template/msg` wants every placeholder as a flat
 * string array "in the order of occurrence" (header text → body → URL
 * button suffixes). Media headers use the separate `message` form field.
 */
export function buildGupshupSelfServeTemplateParams(
  template: MessageTemplate | undefined,
  messageParams?: SendTimeParams,
  fallbackBody?: string[],
): string[] {
  const body = messageParams?.body ?? fallbackBody ?? []
  if (!template) return body.map(String)

  const out: string[] = []

  if (template.header_type === 'text' && template.header_content) {
    const headerVars = extractVariableIndices(template.header_content)
    if (headerVars.length > 0) {
      out.push(messageParams?.headerText?.trim() ?? '')
    }
  }

  const bodyVarCount = extractVariableIndices(template.body_text).length
  for (let i = 0; i < bodyVarCount; i++) {
    out.push(String(body[i] ?? ''))
  }

  ;(template.buttons ?? []).forEach((button, index) => {
    if (button.type !== 'URL') return
    if (extractVariableIndices(button.url).length === 0) return
    out.push(String(messageParams?.buttonParams?.[index] ?? ''))
  })

  return out
}

/** True when meta_template_id is a Gupshup template UUID (Self-Serve `id`). */
export function isGupshupTemplateUuid(id: string | null | undefined): boolean {
  return Boolean(id && isLikelyGupshupAppId(id))
}

function missingSelfServeHint(ctx?: GupshupSelfServeContext | null): string {
  const missing: string[] = []
  if (!(ctx?.sourcePhone?.trim() || process.env.GUPSHUP_SOURCE_PHONE?.trim())) {
    missing.push('display phone / GUPSHUP_SOURCE_PHONE')
  }
  if (!(ctx?.appName?.trim() || process.env.GUPSHUP_APP_NAME?.trim())) {
    missing.push('gupshup_app_name / GUPSHUP_APP_NAME')
  }
  return missing.length
    ? `Self-Serve fallback skipped — set ${missing.join(' and ')} in Gupshup Admin or .env.local`
    : 'Self-Serve fallback skipped'
}

async function parseGupshupV3Response(
  response: Response,
): Promise<GupshupSendResult> {
  let data: GupshupErrorResponse = {}
  try {
    data = (await response.json()) as GupshupErrorResponse
  } catch {
    if (!response.ok) {
      throw new Error(`Gupshup API error: ${response.status}`)
    }
    throw new Error('Gupshup returned an unreadable response')
  }

  if (!response.ok || data.status === 'error') {
    const message = extractGupshupErrorMessage(
      data,
      `Gupshup API error: ${response.status}`,
    )
    console.error(
      '[gupshup-api] v3 send failed',
      JSON.stringify({ status: response.status, message, body: data }),
    )
    throw new Error(message)
  }

  const messageId = data.messages?.[0]?.id
  if (!messageId) {
    throw new Error(
      extractGupshupErrorMessage(data, 'Gupshup returned no message id'),
    )
  }
  console.log(
    '[gupshup-api] v3 send ok',
    JSON.stringify({ status: response.status, message_id: messageId }),
  )
  return { messageId }
}

type V3AuthMode = 'raw' | 'bearer'

async function postGupshupV3(
  appId: string,
  apiToken: string,
  body: Record<string, unknown>,
  encoding: 'json' | 'form',
  authMode: V3AuthMode,
): Promise<GupshupSendResult> {
  const url = `${GUPSHUP_PARTNER_BASE}/partner/app/${appId}/v3/message`
  const token = normalizeGupshupApiToken(apiToken)
  const authorization = authMode === 'bearer' ? `Bearer ${token}` : token

  console.log(
    '[gupshup-api] v3 attempt',
    JSON.stringify({
      encoding,
      authMode,
      appId,
      to: body.to ?? null,
      type: body.type ?? null,
      tokenPrefix: token.slice(0, 6),
      tokenLen: token.length,
    }),
  )

  const response = await fetch(url, {
    method: 'POST',
    headers:
      encoding === 'json'
        ? {
            Authorization: authorization,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          }
        : {
            Authorization: authorization,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
    body:
      encoding === 'json'
        ? JSON.stringify(body)
        : toFormBody(body).toString(),
  })

  return parseGupshupV3Response(response)
}

export interface SendGupshupV3MessageArgs {
  appId: string
  apiToken: string
  body: Record<string, unknown>
}

/** Low-level Meta-shaped POST to Gupshup Passthrough V3 (auth + encoding retries). */
export async function sendGupshupV3Message(
  args: SendGupshupV3MessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, body } = args
  const attempts: Array<{ encoding: 'json' | 'form'; authMode: V3AuthMode }> = [
    { encoding: 'json', authMode: 'raw' },
    { encoding: 'json', authMode: 'bearer' },
    { encoding: 'form', authMode: 'raw' },
    { encoding: 'form', authMode: 'bearer' },
  ]

  let lastError: Error | null = null
  for (const attempt of attempts) {
    try {
      return await postGupshupV3(
        appId,
        apiToken,
        body,
        attempt.encoding,
        attempt.authMode,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastError = err instanceof Error ? err : new Error(message)
      if (!isParamReviewError(message) && !/authentication failed/i.test(message)) {
        throw lastError
      }
    }
  }

  throw lastError ?? new Error('Gupshup V3 send failed')
}

async function postGupshupSelfServe(
  apiToken: string,
  path: '/wa/api/v1/msg' | '/wa/api/v1/template/msg',
  form: Record<string, string>,
): Promise<GupshupSendResult> {
  const url = `${GUPSHUP_WA_API_BASE}${path}`
  const token = normalizeGupshupApiToken(apiToken)

  console.log(
    '[gupshup-api] self-serve attempt',
    JSON.stringify({
      path,
      source: form.source ?? null,
      destination: form.destination ?? null,
      appName: form['src.name'] ?? null,
      tokenPrefix: token.slice(0, 6),
      tokenLen: token.length,
      hasTemplate: Boolean(form.template),
      hasMessage: Boolean(form.message),
    }),
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: token,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  })

  let data: GupshupErrorResponse = {}
  try {
    data = (await response.json()) as GupshupErrorResponse
  } catch {
    if (!response.ok) {
      throw new Error(`Gupshup Self-Serve API error: ${response.status}`)
    }
    throw new Error('Gupshup Self-Serve returned an unreadable response')
  }

  // Docs: 200–299 / 202 with status submitted|success.
  if (!response.ok || data.status === 'error') {
    const message = extractGupshupErrorMessage(
      data,
      `Gupshup Self-Serve API error: ${response.status}`,
    )
    console.error(
      '[gupshup-api] self-serve failed',
      JSON.stringify({ status: response.status, message, body: data }),
    )
    throw new Error(message)
  }

  const messageId = data.messageId || data.messages?.[0]?.id
  if (!messageId) {
    throw new Error(
      extractGupshupErrorMessage(data, 'Gupshup Self-Serve returned no message id'),
    )
  }

  console.log(
    '[gupshup-api] self-serve send ok',
    JSON.stringify({ status: response.status, message_id: messageId }),
  )
  return { messageId }
}

/**
 * Prefer Self-Serve when source phone + app name + api key are available,
 * otherwise Partner V3. If Self-Serve fails, still try V3.
 * If V3 fails and Self-Serve was not configured, surface a clear setup hint.
 */
async function withSelfServeOrV3(
  v3: () => Promise<GupshupSendResult>,
  selfServe: (() => Promise<GupshupSendResult>) | null,
  selfServeCtx?: GupshupSelfServeContext | null,
): Promise<GupshupSendResult> {
  if (selfServe) {
    try {
      return await selfServe()
    } catch (ssErr) {
      const ssMessage = ssErr instanceof Error ? ssErr.message : String(ssErr)
      console.warn(
        `[gupshup-api] Self-Serve failed (${ssMessage}); trying Partner V3`,
      )
      try {
        return await v3()
      } catch (v3Err) {
        const v3Message = v3Err instanceof Error ? v3Err.message : String(v3Err)
        throw new Error(
          `Self-Serve: ${ssMessage}. Partner V3: ${v3Message}`,
        )
      }
    }
  }

  try {
    return await v3()
  } catch (v3Err) {
    const v3Message = v3Err instanceof Error ? v3Err.message : String(v3Err)
    if (isParamReviewError(v3Message) || /authentication failed/i.test(v3Message)) {
      throw new Error(`${v3Message}. ${missingSelfServeHint(selfServeCtx)}`)
    }
    throw v3Err
  }
}

export interface SendGupshupTextMessageArgs {
  appId: string
  apiToken: string
  to: string
  text: string
  contextMessageId?: string
  selfServe?: GupshupSelfServeContext | null
}

/** Send a session text message (Self-Serve → Partner /msg → V3). */
export async function sendGupshupTextMessage(
  args: SendGupshupTextMessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, to, text, contextMessageId, selfServe } = args
  const dest = digitsOnly(to)
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: dest,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const resolvedSs = resolveGupshupSelfServeContext(selfServe)
  const partnerToken = normalizeGupshupApiToken(apiToken)
  const ssKey = pickGupshupSelfServeApiKey({
    storedToken: selfServe?.apiKey ?? resolvedSs?.apiKey,
    partnerAppToken: partnerToken,
  })
  const sourcePhone = resolvedSs?.sourcePhone
    ? digitsOnly(resolvedSs.sourcePhone)
    : ''
  const appName = resolvedSs?.appName?.trim() || ''
  const errors: string[] = []

  const ssMessage: Record<string, unknown> = { type: 'text', text }
  if (contextMessageId) {
    ssMessage.context = { msgId: contextMessageId }
  }

  // Self-Serve first — DigiGlobal accepts sk_ as apikey; Partner often 400s.
  if (sourcePhone && appName && ssKey) {
    try {
      return await postGupshupSelfServe(ssKey, '/wa/api/v1/msg', {
        channel: 'whatsapp',
        source: sourcePhone,
        destination: dest,
        'src.name': appName,
        message: JSON.stringify(ssMessage),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Self-Serve: ${msg}`)
      console.warn(`[gupshup-api] Self-Serve /msg failed (${msg}); trying fallbacks`)
    }
  }

  if (sourcePhone && appName && partnerToken.startsWith('sk_')) {
    try {
      return await postGupshupPartnerForm(
        appId,
        partnerToken,
        `/partner/app/${appId}/msg`,
        {
          channel: 'whatsapp',
          source: sourcePhone,
          destination: dest,
          'src.name': appName,
          message: JSON.stringify(ssMessage),
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Partner /msg: ${msg}`)
      console.warn(`[gupshup-api] Partner /msg failed (${msg}); trying fallbacks`)
    }
  }

  try {
    return await sendGupshupV3Message({ appId, apiToken: partnerToken, body })
  } catch (err) {
    const v3Message = err instanceof Error ? err.message : String(err)
    errors.push(`Partner V3: ${v3Message}`)
    throw new Error(
      `${errors.join(' | ')}. ${missingSelfServeHint(selfServe)}`,
    )
  }
}

export interface SendGupshupMediaMessageArgs {
  appId: string
  apiToken: string
  to: string
  kind: GupshupMediaKind
  link: string
  caption?: string
  filename?: string
  contextMessageId?: string
  selfServe?: GupshupSelfServeContext | null
}

/** Send a session media message (V3, with Self-Serve fallback). */
export async function sendGupshupMediaMessage(
  args: SendGupshupMediaMessageArgs,
): Promise<GupshupSendResult> {
  const {
    appId,
    apiToken,
    to,
    kind,
    link,
    caption,
    filename,
    contextMessageId,
    selfServe,
  } = args
  if (!link) throw new Error('sendGupshupMediaMessage requires a link')

  const dest = digitsOnly(to)
  const media: Record<string, unknown> = { link }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: dest,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const resolvedSs = resolveGupshupSelfServeContext(selfServe)
  const selfServeKey = pickGupshupSelfServeApiKey({
    storedToken: selfServe?.apiKey,
    partnerAppToken: apiToken,
  })
  return withSelfServeOrV3(
    () => sendGupshupV3Message({ appId, apiToken, body }),
    resolvedSs && selfServeKey
      ? () => {
          // Self-Serve uses "file" for documents.
          const ssType = kind === 'document' ? 'file' : kind
          const message: Record<string, unknown> = {
            type: ssType,
            url: link,
          }
          if (caption && kind !== 'audio') message.caption = caption
          if (kind === 'document' && filename) message.filename = filename
          if (contextMessageId) {
            message.context = { msgId: contextMessageId }
          }
          return postGupshupSelfServe(selfServeKey, '/wa/api/v1/msg', {
            channel: 'whatsapp',
            source: digitsOnly(resolvedSs.sourcePhone!),
            destination: dest,
            'src.name': resolvedSs.appName!.trim(),
            message: JSON.stringify(message),
          })
        }
      : null,
    selfServe,
  )
}

export interface SendGupshupTemplateMessageArgs {
  appId: string
  apiToken: string
  to: string
  templateName: string
  language?: string
  /** Legacy body-only params when no template row is available. */
  params?: string[]
  template?: MessageTemplate
  messageParams?: SendTimeParams
  contextMessageId?: string
  selfServe?: GupshupSelfServeContext | null
}

async function postGupshupPartnerForm(
  appId: string,
  apiToken: string,
  path: string,
  form: Record<string, string>,
): Promise<GupshupSendResult> {
  const url = `${GUPSHUP_PARTNER_BASE}${path}`
  const token = normalizeGupshupApiToken(apiToken)

  console.log(
    '[gupshup-api] partner form attempt',
    JSON.stringify({
      path,
      source: form.source ?? null,
      destination: form.destination ?? null,
      appName: form['src.name'] ?? null,
      tokenPrefix: token.slice(0, 6),
      tokenLen: token.length,
      hasTemplate: Boolean(form.template),
      hasMessage: Boolean(form.message),
    }),
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Connection: 'keep-alive',
    },
    body: new URLSearchParams(form).toString(),
  })

  let data: GupshupErrorResponse = {}
  try {
    data = (await response.json()) as GupshupErrorResponse
  } catch {
    if (!response.ok) {
      throw new Error(`Gupshup Partner API error: ${response.status}`)
    }
    throw new Error('Gupshup Partner returned an unreadable response')
  }

  if (!response.ok || data.status === 'error') {
    const message = extractGupshupErrorMessage(
      data,
      `Gupshup Partner API error: ${response.status}`,
    )
    console.error(
      '[gupshup-api] partner form failed',
      JSON.stringify({ status: response.status, message, body: data }),
    )
    throw new Error(message)
  }

  const messageId = data.messageId || data.messages?.[0]?.id
  if (!messageId) {
    throw new Error(
      extractGupshupErrorMessage(data, 'Gupshup Partner returned no message id'),
    )
  }

  console.log(
    '[gupshup-api] partner form ok',
    JSON.stringify({ status: response.status, message_id: messageId }),
  )
  return { messageId }
}

function buildTemplateMediaMessageFormValue(
  template: MessageTemplate,
  messageParams?: SendTimeParams,
): string | null {
  const headerType = template.header_type?.toLowerCase()
  if (
    headerType !== 'image' &&
    headerType !== 'video' &&
    headerType !== 'document'
  ) {
    return null
  }
  const link =
    messageParams?.headerMediaUrl || template.header_media_url || ''
  if (!link) {
    throw new Error(
      `${headerType} template requires a public media URL (message.link)`,
    )
  }
  const mediaType = headerType === 'document' ? 'document' : headerType
  return JSON.stringify({
    type: mediaType,
    [mediaType]: { link },
  })
}

/**
 * Send an approved WhatsApp template.
 *
 * Order (Self-Serve first — DigiGlobal accepts sk_ as `apikey`):
 * 1. Self-Serve /wa/api/v1/template/msg
 * 2. Partner /partner/app/{appId}/template/msg
 * 3. Partner V3 Meta-shaped /v3/message
 */
export async function sendGupshupTemplateMessage(
  args: SendGupshupTemplateMessageArgs,
): Promise<GupshupSendResult> {
  const {
    appId,
    apiToken,
    to,
    templateName,
    language = 'en_US',
    params,
    template,
    messageParams,
    contextMessageId,
    selfServe,
  } = args

  const dest = digitsOnly(to)
  const langCode = normalizeGupshupTemplateLanguage(language)
  const bodyParams = messageParams?.body ?? params ?? []
  const flatParams = buildGupshupSelfServeTemplateParams(
    template,
    messageParams,
    params,
  )

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: {
      policy: 'deterministic',
      code: langCode,
    },
  }

  if (template) {
    const components = buildSendComponents(template, {
      body: bodyParams,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    })
    if (components.length > 0) {
      templatePayload.components = components
    }
  } else if (bodyParams.length > 0) {
    templatePayload.components = [
      {
        type: 'body',
        parameters: bodyParams.map((p) => ({ type: 'text', text: String(p) })),
      },
    ]
  }

  const v3Body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: dest,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    v3Body.context = { message_id: contextMessageId }
  }

  const resolvedSs = resolveGupshupSelfServeContext(selfServe)
  const partnerToken = normalizeGupshupApiToken(apiToken)
  const ssKey = pickGupshupSelfServeApiKey({
    storedToken: selfServe?.apiKey ?? resolvedSs?.apiKey,
    partnerAppToken: partnerToken,
  })
  const templateUuid = template?.meta_template_id?.trim() || ''
  const hasUuid = isGupshupTemplateUuid(templateUuid)
  const sourcePhone = resolvedSs?.sourcePhone
    ? digitsOnly(resolvedSs.sourcePhone)
    : ''
  const appName = resolvedSs?.appName?.trim() || ''
  const errors: string[] = []

  const buildTemplateForm = (): Record<string, string> => {
    const form: Record<string, string> = {
      channel: 'whatsapp',
      source: sourcePhone,
      destination: dest,
      'src.name': appName,
      template: JSON.stringify({
        id: templateUuid,
        params: flatParams.map(String),
      }),
    }
    if (template) {
      const media = buildTemplateMediaMessageFormValue(template, messageParams)
      if (media) form.message = media
    }
    return form
  }

  // 1) Self-Serve — DigiGlobal accepts sk_ as apikey; Partner often 400s.
  if (hasUuid && sourcePhone && appName && ssKey) {
    try {
      console.log(
        '[gupshup-api] template via Self-Serve /wa/api/v1/template/msg',
        JSON.stringify({
          templateId: templateUuid,
          templateName,
          paramCount: flatParams.length,
        }),
      )
      return await postGupshupSelfServe(
        ssKey,
        '/wa/api/v1/template/msg',
        buildTemplateForm(),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Self-Serve: ${msg}`)
      console.warn(`[gupshup-api] Self-Serve template failed (${msg})`)
    }
  } else {
    console.warn(
      '[gupshup-api] Self-Serve template skipped',
      JSON.stringify({
        hasUuid,
        hasSourcePhone: Boolean(sourcePhone),
        hasAppName: Boolean(appName),
        hasApiKey: Boolean(ssKey),
        templateName,
        meta_template_id: templateUuid || null,
        hint: !hasUuid
          ? 'meta_template_id is not a Gupshup UUID — Sync from Gupshup'
          : null,
      }),
    )
  }

  // 2) Partner native template API.
  if (hasUuid && sourcePhone && appName && partnerToken) {
    try {
      const form = { ...buildTemplateForm(), sandbox: 'false' }
      console.log(
        '[gupshup-api] template via Partner /template/msg',
        JSON.stringify({
          appId,
          templateId: templateUuid,
          templateName,
          paramCount: flatParams.length,
        }),
      )
      return await postGupshupPartnerForm(
        appId,
        partnerToken,
        `/partner/app/${appId}/template/msg`,
        form,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Partner /template/msg: ${msg}`)
      console.warn(`[gupshup-api] Partner /template/msg failed (${msg})`)
    }
  }

  // 3) V3 Meta-shaped last resort.
  try {
    const attempts: Array<{ encoding: 'json' | 'form'; authMode: V3AuthMode }> =
      [
        { encoding: 'form', authMode: 'raw' },
        { encoding: 'json', authMode: 'raw' },
        { encoding: 'form', authMode: 'bearer' },
        { encoding: 'json', authMode: 'bearer' },
      ]
    let lastError: Error | null = null
    for (const attempt of attempts) {
      try {
        return await postGupshupV3(
          appId,
          partnerToken,
          v3Body,
          attempt.encoding,
          attempt.authMode,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        lastError = err instanceof Error ? err : new Error(message)
        if (
          !isParamReviewError(message) &&
          !/authentication failed/i.test(message)
        ) {
          throw lastError
        }
      }
    }
    throw lastError ?? new Error('Gupshup V3 template send failed')
  } catch (err) {
    const v3Message = err instanceof Error ? err.message : String(err)
    errors.push(`Partner V3: ${v3Message}`)
    const setupHints: string[] = []
    if (!hasUuid) {
      setupHints.push(
        'template meta_template_id must be a Gupshup UUID — run Sync from Gupshup',
      )
    }
    if (!sourcePhone || !appName) {
      setupHints.push(
        'set display phone + gupshup_app_name on the WhatsApp config',
      )
    }
    throw new Error(
      `${errors.join(' | ')}${
        setupHints.length ? ` | Fix: ${setupHints.join('; ')}` : ''
      }`,
    )
  }
}

export interface SendGupshupReactionMessageArgs {
  appId: string
  apiToken: string
  to: string
  /** WhatsApp / Gupshup message id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove the reaction. */
  emoji: string
  selfServe?: GupshupSelfServeContext | null
}

/** Send a reaction (or removal) via Partner V3 or Self-Serve WA API. */
export async function sendGupshupReactionMessage(
  args: SendGupshupReactionMessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, to, targetMessageId, emoji, selfServe } = args
  const dest = digitsOnly(to)

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: dest,
    type: 'reaction',
    reaction: { message_id: targetMessageId, emoji },
  }

  const resolvedSs = resolveGupshupSelfServeContext(selfServe)
  const selfServeKey = pickGupshupSelfServeApiKey({
    storedToken: selfServe?.apiKey,
    partnerAppToken: apiToken,
  })
  return withSelfServeOrV3(
    () => sendGupshupV3Message({ appId, apiToken, body }),
    resolvedSs && selfServeKey
      ? () => {
          const form: Record<string, string> = {
            channel: 'whatsapp',
            source: digitsOnly(resolvedSs.sourcePhone!),
            destination: dest,
            'src.name': resolvedSs.appName!.trim(),
            message: JSON.stringify({
              type: 'reaction',
              msgId: targetMessageId,
              emoji,
            }),
          }
          return postGupshupSelfServe(selfServeKey, '/wa/api/v1/msg', form)
        }
      : null,
    selfServe,
  )
}
