/**
 * Gupshup messaging — Partner Passthrough V3 + Self-Serve WA API fallback.
 *
 * Primary: https://partner.gupshup.io/partner/app/{appId}/v3/message
 * Fallback: https://api.gupshup.io/wa/api/v1/msg (and /template/msg)
 *
 * Many installs store a Console `apikey` (not Partner `sk_`). V3 rejects
 * that with "Please review the request parameters"; Self-Serve accepts it.
 */

import { normalizeGupshupApiToken } from '@/lib/whatsapp/gupshup-auth'
import {
  buildSendComponents,
  type SendTimeParams,
} from '@/lib/whatsapp/template-send-builder'
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

function canSelfServe(ctx?: GupshupSelfServeContext | null): boolean {
  return Boolean(ctx?.sourcePhone?.trim() && ctx?.appName?.trim())
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

async function withV3ThenSelfServe(
  v3: () => Promise<GupshupSendResult>,
  selfServe: (() => Promise<GupshupSendResult>) | null,
): Promise<GupshupSendResult> {
  try {
    return await v3()
  } catch (v3Err) {
    const v3Message = v3Err instanceof Error ? v3Err.message : String(v3Err)
    if (!selfServe || (!isParamReviewError(v3Message) && !/authentication failed/i.test(v3Message))) {
      throw v3Err
    }
    console.warn(
      `[gupshup-api] V3 failed (${v3Message}); falling back to Self-Serve WA API`,
    )
    try {
      return await selfServe()
    } catch (ssErr) {
      const ssMessage = ssErr instanceof Error ? ssErr.message : String(ssErr)
      throw new Error(
        `Partner V3: ${v3Message}. Self-Serve fallback: ${ssMessage}`,
      )
    }
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

/** Send a session text message (V3, with Self-Serve fallback). */
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

  return withV3ThenSelfServe(
    () => sendGupshupV3Message({ appId, apiToken, body }),
    canSelfServe(selfServe)
      ? () => {
          const message: Record<string, unknown> = {
            type: 'text',
            text,
          }
          if (contextMessageId) {
            message.context = { msgId: contextMessageId }
          }
          return postGupshupSelfServe(apiToken, '/wa/api/v1/msg', {
            channel: 'whatsapp',
            source: digitsOnly(selfServe!.sourcePhone!),
            destination: dest,
            'src.name': selfServe!.appName!.trim(),
            message: JSON.stringify(message),
          })
        }
      : null,
  )
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

  return withV3ThenSelfServe(
    () => sendGupshupV3Message({ appId, apiToken, body }),
    canSelfServe(selfServe)
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
          return postGupshupSelfServe(apiToken, '/wa/api/v1/msg', {
            channel: 'whatsapp',
            source: digitsOnly(selfServe!.sourcePhone!),
            destination: dest,
            'src.name': selfServe!.appName!.trim(),
            message: JSON.stringify(message),
          })
        }
      : null,
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

/**
 * Send an approved WhatsApp template (V3 Meta-shaped, Self-Serve fallback).
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
  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  const bodyParams = messageParams?.body ?? params ?? []

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

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: dest,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  return withV3ThenSelfServe(
    () => sendGupshupV3Message({ appId, apiToken, body }),
    canSelfServe(selfServe) && template?.meta_template_id
      ? () => {
          const form: Record<string, string> = {
            channel: 'whatsapp',
            source: digitsOnly(selfServe!.sourcePhone!),
            destination: dest,
            'src.name': selfServe!.appName!.trim(),
            template: JSON.stringify({
              id: template.meta_template_id,
              params: bodyParams.map(String),
            }),
          }

          // Media header templates need an extra message object on Self-Serve.
          const headerType = template.header_type?.toLowerCase()
          if (
            headerType === 'image' ||
            headerType === 'video' ||
            headerType === 'document'
          ) {
            const link =
              messageParams?.headerMediaUrl || template.header_media_url || ''
            if (link) {
              form.message = JSON.stringify({
                type: headerType === 'document' ? 'document' : headerType,
                [headerType === 'document' ? 'document' : headerType]: {
                  link,
                },
              })
            }
          }

          return postGupshupSelfServe(apiToken, '/wa/api/v1/template/msg', form)
        }
      : null,
  )
}
