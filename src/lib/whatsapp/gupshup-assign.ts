import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'

export interface AssignGupshupInput {
  accountId: string
  gupshupAppId: string
  /** Required for new assignments; omit on update to keep the stored key. */
  apiKey?: string
  phoneNumberId: string
  displayPhoneNumber: string
  gsAppId?: string | null
}

export interface AssignGupshupResult {
  accountId: string
  displayPhoneNumber: string
  webhookUrl: string
  updated: boolean
}

export class AssignGupshupError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AssignGupshupError'
    this.status = status
  }
}

export async function assignGupshupAccount(
  db: SupabaseClient,
  input: AssignGupshupInput,
): Promise<AssignGupshupResult> {
  const {
    accountId,
    gupshupAppId,
    apiKey,
    phoneNumberId,
    displayPhoneNumber,
    gsAppId = null,
  } = input

  const { data: existing } = await db
    .from('whatsapp_config')
    .select('id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()

  const trimmedKey = apiKey?.trim() ?? ''
  if (!existing && !trimmedKey) {
    throw new AssignGupshupError('api_key is required', 400)
  }

  const { data: account, error: accountErr } = await db
    .from('accounts')
    .select('id, owner_user_id')
    .eq('id', accountId)
    .maybeSingle()

  if (accountErr) {
    console.error('[gupshup-assign] account lookup:', accountErr)
    throw new AssignGupshupError('Failed to look up account', 500)
  }
  if (!account) throw new AssignGupshupError('Account not found', 404)

  const { data: claimed } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()

  if (claimed) {
    throw new AssignGupshupError(
      'This phone_number_id is already assigned to another account',
      409,
    )
  }

  let accessToken = existing?.access_token as string | undefined
  if (trimmedKey) {
    try {
      accessToken = encrypt(trimmedKey)
    } catch (err) {
      console.error('[gupshup-assign] encrypt failed:', err)
      throw new AssignGupshupError(
        'Failed to encrypt api_key — check ENCRYPTION_KEY',
        500,
      )
    }
  }
  if (!accessToken) {
    throw new AssignGupshupError('api_key is required', 400)
  }

  const effectiveGsAppId = (gsAppId?.trim() || gupshupAppId.trim()) || null

  const row = {
    provider: 'gupshup' as const,
    gupshup_app_id: gupshupAppId,
    gs_app_id: effectiveGsAppId,
    phone_number_id: phoneNumberId,
    display_phone_number: displayPhoneNumber,
    access_token: accessToken,
    waba_id: null,
    verify_token: null,
    status: 'connected' as const,
    connected_at: new Date().toISOString(),
    registered_at: new Date().toISOString(),
    subscribed_apps_at: new Date().toISOString(),
    last_registration_error: null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error: upErr } = await db
      .from('whatsapp_config')
      .update(row)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[gupshup-assign] update:', upErr)
      throw new AssignGupshupError('Failed to update assignment', 500)
    }
  } else {
    const { error: insErr } = await db.from('whatsapp_config').insert({
      account_id: accountId,
      user_id: account.owner_user_id,
      ...row,
    })
    if (insErr) {
      console.error('[gupshup-assign] insert:', insErr)
      throw new AssignGupshupError('Failed to create assignment', 500)
    }
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    'https://your-domain.example'

  return {
    accountId,
    displayPhoneNumber,
    webhookUrl: `${siteUrl}/api/whatsapp/webhook`,
    updated: Boolean(existing),
  }
}

export async function removeGupshupAssignment(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db
    .from('whatsapp_config')
    .delete()
    .eq('account_id', accountId)
    .eq('provider', 'gupshup')

  if (error) {
    console.error('[gupshup-assign] delete:', error)
    throw new AssignGupshupError('Failed to remove assignment', 500)
  }
}

export function publicWebhookUrl(): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    'https://your-domain.example'
  return `${siteUrl}/api/whatsapp/webhook`
}
