/**
 * Resolve Gupshup app credentials for Partner / WA API calls.
 *
 * Partner apps use a two-level token model:
 * 1. GUPSHUP_PARTNER_TOKEN (platform env) — JWT from partner login
 * 2. Per-app access token (sk_…) — fetched via GET /partner/app/{appId}/token
 */

import { decrypt } from '@/lib/whatsapp/encryption'

const GUPSHUP_PARTNER_BASE =
  process.env.GUPSHUP_PARTNER_API_BASE ?? 'https://partner.gupshup.io'

interface GupshupAppTokenResponse {
  status?: string
  message?: string
  token?: {
    token?: string
  }
}

export interface GupshupAppCredentials {
  appId: string
  apiToken: string
}

/**
 * Normalize a Gupshup Partner App access token for the Authorization header.
 * Gupshup expects the raw token (sk_…), not a Bearer prefix.
 */
export function normalizeGupshupApiToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice('bearer '.length).trim()
  }
  return trimmed
}

/**
 * Self-Serve `/wa/api/v1/*` needs a Console hex `apikey`, not a Partner `sk_`
 * token. Prefer the encrypted assign-time key when it isn't an sk_ token.
 */
export function pickGupshupSelfServeApiKey(args: {
  storedToken?: string | null
  partnerAppToken?: string | null
}): string | null {
  const envKey =
    process.env.GUPSHUP_API_KEY?.trim() ||
    process.env.GUPSHUP_WA_API_KEY?.trim() ||
    null
  const stored = args.storedToken?.trim() || null
  const partner = args.partnerAppToken?.trim() || null
  // Self-Serve needs the Console hex apikey (never sk_).
  if (envKey && !envKey.startsWith('sk_')) return envKey
  if (stored && !stored.startsWith('sk_')) return stored
  if (partner && !partner.startsWith('sk_')) return partner
  return null
}

/** Partner app ids are UUIDs — not Meta phone_number_id numerics. */
export function isLikelyGupshupAppId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id.trim(),
  )
}

/**
 * Pick the app id for Partner API paths. Prefer gupshup_app_id; fall back to
 * gs_app_id when the primary field looks like a mistaken phone_number_id.
 */
export function resolveGupshupAppId(config: {
  gupshup_app_id?: string | null
  gs_app_id?: string | null
}): string {
  const primary = config.gupshup_app_id?.trim() ?? ''
  if (primary && isLikelyGupshupAppId(primary)) return primary

  const fallback = config.gs_app_id?.trim() ?? ''
  if (fallback && isLikelyGupshupAppId(fallback)) return fallback

  if (primary && /^\d+$/.test(primary)) {
    throw new Error(
      `gupshup_app_id looks like a Meta phone_number_id (${primary}). Use the Gupshup Partner app UUID (e.g. bf9ee64c-3d4d-4ac4-8668-732e577007c4) in Gupshup Admin.`,
    )
  }

  throw new Error(
    'Gupshup app id is missing or invalid — re-assign the account in Gupshup Admin with the Partner app UUID.',
  )
}

/** Gupshup/Meta context.message_id must be a WhatsApp message id (wamid.…). */
export function gupshupContextMessageId(
  messageId: string | undefined,
): string | undefined {
  if (!messageId?.trim()) return undefined
  const id = messageId.trim()
  return id.startsWith('wamid.') ? id : undefined
}

/** Read the per-account app token stored at assign time (encrypted in DB). */
export function readStoredGupshupApiToken(accessToken: string): string | null {
  try {
    const token = normalizeGupshupApiToken(decrypt(accessToken))
    return token || null
  } catch {
    return null
  }
}

function isPartnerTokenFetchFailure(message: string): boolean {
  return (
    isGupshupAuthError(message) ||
    /\b(401|403)\b/.test(message) ||
    /token api error/i.test(message)
  )
}

/** Fetch a fresh Partner App access token for one app. */
export async function fetchGupshupAppToken(
  appId: string,
  partnerToken: string,
): Promise<string> {
  const url = `${GUPSHUP_PARTNER_BASE}/partner/app/${appId}/token`
  const response = await fetch(url, {
    headers: { Authorization: normalizeGupshupApiToken(partnerToken) },
  })

  if (!response.ok) {
    let message = `Gupshup token API error: ${response.status}`
    try {
      const body = (await response.json()) as GupshupAppTokenResponse
      if (body.message) message = body.message
    } catch {
      // keep fallback
    }
    throw new Error(message)
  }

  const body = (await response.json()) as GupshupAppTokenResponse
  if (body.status === 'error') {
    throw new Error(body.message ?? 'Failed to fetch Gupshup app token')
  }

  const token = body.token?.token?.trim()
  if (!token) {
    throw new Error('Gupshup token API returned no app token')
  }
  return token
}

/**
 * Resolve the API token to use for a customer app.
 *
 * When GUPSHUP_PARTNER_TOKEN is set we try to fetch a fresh sk_ token for
 * the app. If the partner JWT cannot access that app (403/401), we fall back
 * to the per-account API key saved during Gupshup Admin assign.
 */
export async function resolveGupshupAppCredentials(config: {
  gupshup_app_id?: string | null
  gs_app_id?: string | null
  access_token: string
}): Promise<GupshupAppCredentials> {
  const appId = resolveGupshupAppId(config)
  const partnerToken = process.env.GUPSHUP_PARTNER_TOKEN?.trim()
  const storedToken = readStoredGupshupApiToken(config.access_token)

  if (partnerToken) {
    try {
      const apiToken = await fetchGupshupAppToken(appId, partnerToken)
      return { appId, apiToken: normalizeGupshupApiToken(apiToken) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (storedToken && isPartnerTokenFetchFailure(message)) {
        console.warn(
          `[gupshup-auth] Partner token could not fetch app token for ${appId} (${message}); using stored app API key.`,
        )
        return { appId, apiToken: storedToken }
      }
      throw err
    }
  }

  if (!storedToken) {
    throw new Error(
      'Gupshup API key missing — paste the app sk_ token in Gupshup Admin, or fix GUPSHUP_PARTNER_TOKEN.',
    )
  }
  return { appId, apiToken: storedToken }
}

/** True when the error looks like an auth / permission failure. */
export function isGupshupAuthError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('unauthor') ||
    lower.includes('authentication') ||
    lower.includes('forbidden') ||
    lower.includes('invalid access token') ||
    lower.includes('do not have permission')
  )
}
