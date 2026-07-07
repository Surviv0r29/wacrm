import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import {
  getGupshupAssignment,
  supabaseServiceAdmin,
} from '@/lib/admin/gupshup-accounts'
import {
  assignGupshupAccount,
  AssignGupshupError,
  publicWebhookUrl,
  removeGupshupAssignment,
} from '@/lib/whatsapp/gupshup-assign'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * GET /api/admin/whatsapp/assign?account_id=
 *
 * Returns the current Gupshup assignment for one account (no API key).
 */
export async function GET(request: Request) {
  const denied = requirePlatformAdmin(request)
  if (denied) return denied

  const accountId = new URL(request.url).searchParams.get('account_id')?.trim()
  if (!accountId) return bad('account_id is required')

  try {
    const assignment = await getGupshupAssignment(accountId)
    return NextResponse.json({
      assignment,
      webhook_url: publicWebhookUrl(),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load assignment' }, { status: 500 })
  }
}

/**
 * POST /api/admin/whatsapp/assign
 *
 * Platform operator assigns a Gupshup app + phone number to a customer
 * account. Protected by PLATFORM_ADMIN_SECRET (header
 * `x-platform-admin-secret` or `Authorization: Bearer …`).
 */
export async function POST(request: Request) {
  const denied = requirePlatformAdmin(request)
  if (denied) return denied

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('Invalid request body')

  const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : ''
  const gupshupAppId =
    typeof body.gupshup_app_id === 'string' ? body.gupshup_app_id.trim() : ''
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : undefined
  const phoneNumberId =
    typeof body.phone_number_id === 'string' ? body.phone_number_id.trim() : ''
  const displayPhone =
    typeof body.display_phone_number === 'string'
      ? body.display_phone_number.trim()
      : ''
  const gsAppId =
    typeof body.gs_app_id === 'string' && body.gs_app_id.trim()
      ? body.gs_app_id.trim()
      : null

  if (!accountId) return bad('account_id is required')
  if (!gupshupAppId) return bad('gupshup_app_id is required')
  if (!phoneNumberId) return bad('phone_number_id is required')
  if (!displayPhone) return bad('display_phone_number is required')

  try {
    const result = await assignGupshupAccount(supabaseServiceAdmin(), {
      accountId,
      gupshupAppId,
      apiKey,
      phoneNumberId,
      displayPhoneNumber: displayPhone,
      gsAppId,
    })

    return NextResponse.json({
      success: true,
      account_id: result.accountId,
      provider: 'gupshup',
      display_phone_number: result.displayPhoneNumber,
      webhook_url: result.webhookUrl,
      updated: result.updated,
      note:
        'Set the Gupshup V3 passthrough subscription callback to webhook_url for this app.',
    })
  } catch (err) {
    if (err instanceof AssignGupshupError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[admin/whatsapp/assign] POST:', err)
    return NextResponse.json({ error: 'Failed to assign account' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/whatsapp/assign?account_id=
 *
 * Removes a Gupshup assignment for the given account.
 */
export async function DELETE(request: Request) {
  const denied = requirePlatformAdmin(request)
  if (denied) return denied

  const accountId = new URL(request.url).searchParams.get('account_id')?.trim()
  if (!accountId) return bad('account_id is required')

  try {
    await removeGupshupAssignment(supabaseServiceAdmin(), accountId)
    return NextResponse.json({ success: true, account_id: accountId })
  } catch (err) {
    if (err instanceof AssignGupshupError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Failed to remove assignment' }, { status: 500 })
  }
}
