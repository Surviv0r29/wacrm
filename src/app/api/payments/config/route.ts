import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase
      .from('payment_configs')
      .select('key_id, key_secret, webhook_secret, is_active, provider')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })

    return NextResponse.json({
      configured: true,
      provider: data.provider,
      key_id: data.key_id,
      is_active: data.is_active,
      has_key_secret: Boolean(data.key_secret),
      has_webhook_secret: Boolean(data.webhook_secret),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const keyId = typeof body.key_id === 'string' ? body.key_id.trim() : ''
    if (!keyId) {
      return NextResponse.json({ error: 'key_id is required' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('payment_configs')
      .select('id, key_secret, webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    let keySecret = existing?.key_secret as string | undefined
    if (typeof body.key_secret === 'string' && body.key_secret.trim()) {
      keySecret = encrypt(body.key_secret.trim())
    }
    if (!keySecret) {
      return NextResponse.json({ error: 'key_secret is required' }, { status: 400 })
    }

    let webhookSecret = existing?.webhook_secret as string | null | undefined
    if (typeof body.webhook_secret === 'string' && body.webhook_secret.trim()) {
      webhookSecret = encrypt(body.webhook_secret.trim())
    }

    const row = {
      account_id: accountId,
      provider: 'razorpay' as const,
      key_id: keyId,
      key_secret: keySecret,
      webhook_secret: webhookSecret ?? null,
      is_active: Boolean(body.is_active),
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error } = await supabase
        .from('payment_configs')
        .update(row)
        .eq('account_id', accountId)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('payment_configs').insert(row)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
