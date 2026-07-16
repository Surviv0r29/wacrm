import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { createPrivilegedSupabaseClient } from '@/lib/supabase/privileged-client'
import {
  assignGupshupAccount,
  AssignGupshupError,
  publicWebhookUrl,
  removeGupshupAssignment,
} from '@/lib/whatsapp/gupshup-assign'

/**
 * Self-serve Gupshup connect for account owners/admins.
 * Platform admin assign at /api/admin/whatsapp/assign remains available.
 */

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const gupshupAppId =
      typeof body.gupshup_app_id === 'string' ? body.gupshup_app_id.trim() : ''
    const gupshupAppName =
      typeof body.gupshup_app_name === 'string' && body.gupshup_app_name.trim()
        ? body.gupshup_app_name.trim()
        : null
    const apiKey =
      typeof body.api_key === 'string' ? body.api_key.trim() : undefined
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

    if (!gupshupAppId) {
      return NextResponse.json({ error: 'gupshup_app_id is required' }, { status: 400 })
    }
    if (!phoneNumberId) {
      return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 })
    }
    if (!displayPhone) {
      return NextResponse.json(
        { error: 'display_phone_number is required' },
        { status: 400 },
      )
    }

    const result = await assignGupshupAccount(createPrivilegedSupabaseClient(), {
      accountId,
      gupshupAppId,
      gupshupAppName,
      apiKey,
      phoneNumberId,
      displayPhoneNumber: displayPhone,
      gsAppId,
    })

    return NextResponse.json({
      success: true,
      provider: 'gupshup',
      display_phone_number: result.displayPhoneNumber,
      webhook_url: result.webhookUrl,
      updated: result.updated,
      note: 'Set your Gupshup app callback / webhook to webhook_url.',
    })
  } catch (err) {
    if (err instanceof AssignGupshupError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    await removeGupshupAssignment(createPrivilegedSupabaseClient(), accountId)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AssignGupshupError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data } = await supabase
      .from('whatsapp_config')
      .select(
        'provider, status, display_phone_number, phone_number_id, gupshup_app_id, gupshup_app_name, gs_app_id, registered_at',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    return NextResponse.json({
      config: data,
      webhook_url: publicWebhookUrl(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
