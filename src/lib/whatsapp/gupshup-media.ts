/**
 * Gupshup Partner media download.
 * GET /partner/app/{appId}/media/{mediaId}
 */

import { normalizeGupshupApiToken } from '@/lib/whatsapp/gupshup-auth'

const GUPSHUP_PARTNER_BASE =
  process.env.GUPSHUP_PARTNER_API_BASE ?? 'https://partner.gupshup.io'

export async function downloadGupshupPartnerMedia(args: {
  appId: string
  apiToken: string
  mediaId: string
}): Promise<{ buffer: Buffer; contentType: string }> {
  const { appId, apiToken, mediaId } = args
  const url = `${GUPSHUP_PARTNER_BASE}/partner/app/${encodeURIComponent(appId)}/media/${encodeURIComponent(mediaId)}`
  const token = normalizeGupshupApiToken(apiToken)

  const response = await fetch(url, {
    headers: {
      Authorization: token,
      Accept: '*/*',
    },
  })

  if (!response.ok) {
    let detail = `Gupshup media download failed: ${response.status}`
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) detail = body.message
    } catch {
      // binary error body — keep status fallback
    }
    throw new Error(detail)
  }

  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}
