import { NextResponse } from 'next/server'
import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { createPrivilegedSupabaseClient } from '@/lib/supabase/privileged-client'
import {
  createRazorpayPaymentLink,
  resolveProductForPayment,
  RazorpayError,
} from '@/lib/payments/razorpay'
import { upsertLead } from '@/lib/leads/upsert-lead'
import { engineSendText } from '@/lib/automations/meta-send'

/**
 * POST /api/payments/links
 *
 * Create a Razorpay payment link for a contact (Closer / inbox).
 * Body: { contact_id, product_id?, product_slug?, conversation_id?, send_whatsapp? }
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id.trim() : ''
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id, name, email, phone, account_id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (contactErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const db = createPrivilegedSupabaseClient()
    const product = await resolveProductForPayment(db, accountId, {
      productId: typeof body.product_id === 'string' ? body.product_id : null,
      productSlug: typeof body.product_slug === 'string' ? body.product_slug : null,
    })
    if (!product) {
      return NextResponse.json(
        { error: 'No active paid product found' },
        { status: 400 },
      )
    }

    const amount =
      typeof body.amount === 'number' && body.amount > 0
        ? body.amount
        : Number(product.price_amount)
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Product has no price — set price on Products' },
        { status: 400 },
      )
    }

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : null

    const lead = await upsertLead(db, {
      accountId,
      contactId,
      conversationId,
      productId: product.id,
      interest: product.product_type === 'ebook' ? 'ebook' : 'unknown',
      stage: 'proposal',
      preserveStage: false,
    })

    const link = await createRazorpayPaymentLink(db, {
      accountId,
      contactId,
      leadId: lead?.id ?? null,
      productId: product.id,
      amount,
      currency: product.currency || 'INR',
      description:
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : `Payment for ${product.name}`,
      customerName: contact.name,
      customerEmail: contact.email,
      customerPhone: contact.phone,
    })

    if (body.send_whatsapp !== false && conversationId) {
      try {
        const text =
          `Here's your secure Razorpay link for *${product.name}* ` +
          `(${link.currency} ${amount}):\n${link.shortUrl}\n\n` +
          `_Link expires in 48 hours._`
        await engineSendText({
          accountId,
          userId,
          conversationId,
          contactId,
          text,
        })
      } catch (err) {
        console.warn(
          '[payments/links] WhatsApp send failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    return NextResponse.json({
      payment_link: {
        id: link.id,
        short_url: link.shortUrl,
        razorpay_payment_link_id: link.razorpayPaymentLinkId,
        amount: link.amount,
        currency: link.currency,
      },
      product: { id: product.id, name: product.name },
      lead_id: lead?.id ?? null,
    })
  } catch (err) {
    if (err instanceof RazorpayError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('payment_links')
      .select(
        'id, short_url, amount, currency, status, product_id, contact_id, created_at',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ payment_links: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
