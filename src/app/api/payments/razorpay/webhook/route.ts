import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createPrivilegedSupabaseClient } from '@/lib/supabase/privileged-client'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * POST /api/payments/razorpay/webhook
 *
 * Verifies Razorpay signature and marks payment_links + linked deals as paid/won.
 * account_id is expected in payment link notes (set when creating links).
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''

  let payload: {
    event?: string
    payload?: {
      payment_link?: {
        entity?: {
          id?: string
          notes?: Record<string, string>
          status?: string
        }
      }
    }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notes = payload.payload?.payment_link?.entity?.notes ?? {}
  const accountId = notes.account_id
  const linkId = payload.payload?.payment_link?.entity?.id

  if (!accountId || !linkId) {
    return NextResponse.json({ ok: true, skipped: 'missing_notes' })
  }

  const db = createPrivilegedSupabaseClient()
  const { data: config } = await db
    .from('payment_configs')
    .select('webhook_secret, is_active')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config?.is_active || !config.webhook_secret) {
    return NextResponse.json({ ok: true, skipped: 'inactive' })
  }

  try {
    const secret = decrypt(config.webhook_secret)
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Signature check failed' }, { status: 401 })
  }

  if (payload.event === 'payment_link.paid') {
    const { data: link } = await db
      .from('payment_links')
      .update({
        status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('razorpay_payment_link_id', linkId)
      .select('deal_id, lead_id')
      .maybeSingle()

    if (link?.deal_id) {
      await db
        .from('deals')
        .update({ status: 'won' })
        .eq('id', link.deal_id)
        .eq('account_id', accountId)
    }
    if (link?.lead_id) {
      await db
        .from('leads')
        .update({
          stage: 'won',
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.lead_id)
        .eq('account_id', accountId)
    }
  }

  return NextResponse.json({ ok: true })
}
