import { NextResponse } from 'next/server'
import { listAccountsForAdmin } from '@/lib/admin/gupshup-accounts'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { publicWebhookUrl } from '@/lib/whatsapp/gupshup-assign'

/**
 * GET /api/admin/accounts
 *
 * Lists all customer accounts with owner profile and WhatsApp status.
 */
export async function GET(request: Request) {
  const denied = requirePlatformAdmin(request)
  if (denied) return denied

  try {
    const accounts = await listAccountsForAdmin()
    return NextResponse.json({
      accounts,
      webhook_url: publicWebhookUrl(),
    })
  } catch (err) {
    console.error('[admin/accounts] GET:', err)
    return NextResponse.json({ error: 'Failed to list accounts' }, { status: 500 })
  }
}
