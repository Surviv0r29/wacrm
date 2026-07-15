import {
  sendTextMessage,
  sendTemplateMessage,
} from '@/lib/whatsapp/meta-api'
import {
  sendGupshupTextMessage,
  sendGupshupTemplateMessage,
} from '@/lib/whatsapp/gupshup-api'
import {
  resolveGupshupAppCredentials,
} from '@/lib/whatsapp/gupshup-auth'
import { isGupshupProvider } from '@/lib/whatsapp/provider-mode'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import type { MessageTemplate } from '@/types'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side WhatsApp sender (Meta Cloud API + Gupshup).
//
// Mirrors /api/whatsapp/send but uses the service-role client and
// stamps messages as sender_type='bot'. Template sends load the local
// message_templates row so Gupshup Self-Serve gets meta_template_id.
// ------------------------------------------------------------

interface SendTextArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaWhatsApp({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaWhatsApp({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaWhatsApp(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  let templateRow: MessageTemplate | null = null
  if (input.kind === 'template') {
    templateRow = await resolveTemplateRow(
      db,
      input.accountId,
      input.templateName,
      input.language,
    )
  }

  const attempt = async (phone: string): Promise<string> => {
    if (isGupshupProvider(config.provider)) {
      const { appId, apiToken } = await resolveGupshupAppCredentials({
        gupshup_app_id: config.gupshup_app_id,
        gs_app_id: config.gs_app_id,
        access_token: config.access_token,
      })
      const selfServe = {
        sourcePhone: config.display_phone_number,
        appName: config.gupshup_app_name,
      }

      if (input.kind === 'template') {
        const r = await sendGupshupTemplateMessage({
          appId,
          apiToken,
          to: phone,
          templateName: input.templateName,
          language: input.language || templateRow?.language || 'en_US',
          template: templateRow ?? undefined,
          params: input.params || [],
          messageParams: { body: input.params || [] },
          selfServe,
        })
        return r.messageId
      }

      const r = await sendGupshupTextMessage({
        appId,
        apiToken,
        to: phone,
        text: input.text,
        selfServe,
      })
      return r.messageId
    }

    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        template: templateRow ?? undefined,
        messageParams: { body: input.params || [] },
        params: input.params,
      })
      return r.messageId
    }

    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Gupshup: single sanitized phone. Meta: try trunk-0 variants.
  const variants = isGupshupProvider(config.provider)
    ? [sanitized]
    : phoneVariants(sanitized)

  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text =
    input.kind === 'text'
      ? input.text
      : renderTemplateBodyForInbox(templateRow?.body_text, input.params)
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(
      `sent to WhatsApp but DB insert failed: ${msgErr.message}`,
    )
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        content_text?.trim() ||
        (input.kind === 'template'
          ? `[template:${input.templateName}]`
          : input.text),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}

/** Prefer exact language, then same language family (en ≈ en_US), else first name match. */
async function resolveTemplateRow(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  templateName: string,
  language?: string,
): Promise<MessageTemplate | null> {
  const lang = language || 'en_US'
  const { data: exact } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', lang)
    .maybeSingle()
  if (exact && isMessageTemplate(exact)) return exact

  const { data: byName } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .order('created_at', { ascending: false })

  const rows = (byName ?? []).filter(isMessageTemplate)
  if (rows.length === 0) return null

  const langBase = lang.split(/[_-]/)[0]?.toLowerCase()
  const family =
    langBase &&
    rows.find((r) => (r.language ?? '').split(/[_-]/)[0]?.toLowerCase() === langBase)
  if (family) return family

  console.warn(
    '[automations/meta-send] template language miss; using first name match',
    { templateName, requested: lang, using: rows[0].language },
  )
  return rows[0]
}

function renderTemplateBodyForInbox(
  bodyText: string | null | undefined,
  params?: string[],
): string | null {
  if (!bodyText) return null
  if (!params?.length) return bodyText
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n) => {
    const idx = Number(n) - 1
    if (!Number.isFinite(idx) || idx < 0 || idx >= params.length) return match
    return params[idx] ?? match
  })
}
