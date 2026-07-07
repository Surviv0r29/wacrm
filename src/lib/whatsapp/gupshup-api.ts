/**
 * Gupshup Partner Passthrough V3 — Meta-shaped send API.
 *
 * https://partner.gupshup.io/partner/app/{appId}/v3/message
 */

import { normalizeGupshupApiToken } from '@/lib/whatsapp/gupshup-auth'

const GUPSHUP_PARTNER_BASE =
  process.env.GUPSHUP_PARTNER_API_BASE ?? 'https://partner.gupshup.io'

export interface GupshupSendResult {
  messageId: string
}

export type GupshupMediaKind = 'image' | 'video' | 'document' | 'audio'

interface GupshupErrorResponse {
  message?: string
  status?: string
  error?: { message?: string; code?: number | string }
  errors?: Array<{ message?: string; code?: number | string }>
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

async function parseGupshupSendResponse(
  response: Response,
): Promise<GupshupSendResult> {
  let data: GupshupErrorResponse & { messages?: { id?: string }[] } = {}
  try {
    data = (await response.json()) as typeof data
  } catch {
    if (!response.ok) {
      throw new Error(`Gupshup API error: ${response.status}`)
    }
    throw new Error('Gupshup returned an unreadable response')
  }

  if (!response.ok || data.status === 'error') {
    throw new Error(
      extractGupshupErrorMessage(data, `Gupshup API error: ${response.status}`),
    )
  }

  const messageId = data.messages?.[0]?.id
  if (!messageId) {
    throw new Error(
      extractGupshupErrorMessage(data, 'Gupshup returned no message id'),
    )
  }
  console.log(
    '[gupshup-api] send ok',
    JSON.stringify({ status: response.status, message_id: messageId }),
  )
  return { messageId }
}

async function postGupshupV3(
  appId: string,
  apiToken: string,
  body: Record<string, unknown>,
  encoding: 'json' | 'form',
): Promise<GupshupSendResult> {
  const url = `${GUPSHUP_PARTNER_BASE}/partner/app/${appId}/v3/message`
  const auth = normalizeGupshupApiToken(apiToken)

  const response = await fetch(url, {
    method: 'POST',
    headers:
      encoding === 'json'
        ? {
            Authorization: auth,
            'Content-Type': 'application/json',
          }
        : {
            Authorization: auth,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
    body:
      encoding === 'json'
        ? JSON.stringify(body)
        : toFormBody(body).toString(),
  })

  return parseGupshupSendResponse(response)
}

export interface SendGupshupV3MessageArgs {
  appId: string
  apiToken: string
  body: Record<string, unknown>
}

/** Low-level Meta-shaped POST to Gupshup Passthrough V3. */
export async function sendGupshupV3Message(
  args: SendGupshupV3MessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, body } = args

  try {
    return await postGupshupV3(appId, apiToken, body, 'json')
  } catch (jsonErr) {
    const jsonMessage =
      jsonErr instanceof Error ? jsonErr.message : 'JSON send failed'
    if (!isParamReviewError(jsonMessage)) {
      throw jsonErr
    }
    try {
      return await postGupshupV3(appId, apiToken, body, 'form')
    } catch (formErr) {
      const formMessage =
        formErr instanceof Error ? formErr.message : 'Form send failed'
      throw new Error(
        `${jsonMessage}. Retried as form-urlencoded: ${formMessage}`,
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
}

/** Send a session text message via Gupshup Passthrough V3. */
export async function sendGupshupTextMessage(
  args: SendGupshupTextMessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, to, text, contextMessageId } = args
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  return sendGupshupV3Message({ appId, apiToken, body })
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
}

/** Send a session image / video / audio / document via Gupshup Passthrough V3. */
export async function sendGupshupMediaMessage(
  args: SendGupshupMediaMessageArgs,
): Promise<GupshupSendResult> {
  const { appId, apiToken, to, kind, link, caption, filename, contextMessageId } = args
  if (!link) throw new Error('sendGupshupMediaMessage requires a link')

  const media: Record<string, unknown> = { link }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''),
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  return sendGupshupV3Message({ appId, apiToken, body })
}
