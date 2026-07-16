/**
 * Razorpay Payment Links — create + persist for Closer / automations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

const RAZORPAY_API = 'https://api.razorpay.com/v1'

export class RazorpayError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'RazorpayError'
    this.status = status
  }
}

export interface CreatePaymentLinkInput {
  accountId: string
  contactId: string
  leadId?: string | null
  dealId?: string | null
  productId?: string | null
  /** Amount in major currency units (e.g. 499 INR). Converted to paise. */
  amount: number
  currency?: string
  description: string
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  /** Minutes until expiry. Default 48h. */
  expireByMinutes?: number
}

export interface CreatedPaymentLink {
  id: string
  razorpayPaymentLinkId: string
  shortUrl: string
  amount: number
  currency: string
}

interface PaymentConfigRow {
  key_id: string
  key_secret: string
  is_active: boolean
}

async function loadConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<PaymentConfigRow> {
  const { data, error } = await db
    .from('payment_configs')
    .select('key_id, key_secret, is_active')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw new RazorpayError(error.message, 500)
  if (!data?.key_id || !data.key_secret) {
    throw new RazorpayError('Razorpay is not configured for this account', 400)
  }
  if (!data.is_active) {
    throw new RazorpayError('Razorpay payments are disabled for this account', 400)
  }

  let secret: string
  try {
    secret = decrypt(data.key_secret)
  } catch {
    throw new RazorpayError('Failed to decrypt Razorpay key secret', 500)
  }

  return { key_id: data.key_id, key_secret: secret, is_active: true }
}

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
}

/**
 * Create a Razorpay payment link and store a `payment_links` row.
 * Notes include account_id for webhook routing.
 */
export async function createRazorpayPaymentLink(
  db: SupabaseClient,
  input: CreatePaymentLinkInput,
): Promise<CreatedPaymentLink> {
  const config = await loadConfig(db, input.accountId)

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new RazorpayError('amount must be greater than 0')
  }

  const currency = (input.currency || 'INR').toUpperCase()
  const amountMinor = Math.round(input.amount * 100)
  const expireBy = Math.floor(Date.now() / 1000) + (input.expireByMinutes ?? 48 * 60) * 60

  const body = {
    amount: amountMinor,
    currency,
    accept_partial: false,
    description: input.description.slice(0, 255),
    customer: {
      name: input.customerName || undefined,
      email: input.customerEmail || undefined,
      contact: input.customerPhone || undefined,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: {
      account_id: input.accountId,
      contact_id: input.contactId,
      lead_id: input.leadId || '',
      deal_id: input.dealId || '',
      product_id: input.productId || '',
    },
    expire_by: expireBy,
  }

  const res = await fetch(`${RAZORPAY_API}/payment_links`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config.key_id, config.key_secret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => ({}))) as {
    id?: string
    short_url?: string
    error?: { description?: string }
  }

  if (!res.ok || !json.id || !json.short_url) {
    const msg = json.error?.description || `Razorpay error ${res.status}`
    throw new RazorpayError(msg, res.status >= 400 ? res.status : 502)
  }

  const { data: row, error: insErr } = await db
    .from('payment_links')
    .insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      lead_id: input.leadId ?? null,
      deal_id: input.dealId ?? null,
      product_id: input.productId ?? null,
      razorpay_payment_link_id: json.id,
      short_url: json.short_url,
      amount: input.amount,
      currency,
      status: 'created',
    })
    .select('id')
    .single()

  if (insErr || !row) {
    console.error('[razorpay] persist payment_links failed:', insErr?.message)
    // Link exists on Razorpay — still return it for the customer.
    return {
      id: json.id,
      razorpayPaymentLinkId: json.id,
      shortUrl: json.short_url,
      amount: input.amount,
      currency,
    }
  }

  return {
    id: row.id,
    razorpayPaymentLinkId: json.id,
    shortUrl: json.short_url,
    amount: input.amount,
    currency,
  }
}

/**
 * Pick a sellable product for the Closer (ebook with price > 0 preferred).
 */
export async function resolveProductForPayment(
  db: SupabaseClient,
  accountId: string,
  opts?: { productId?: string | null; productSlug?: string | null },
): Promise<{
  id: string
  name: string
  price_amount: number
  currency: string
  product_type: string
} | null> {
  if (opts?.productId) {
    const { data } = await db
      .from('products')
      .select('id, name, price_amount, currency, product_type')
      .eq('account_id', accountId)
      .eq('id', opts.productId)
      .eq('is_active', true)
      .maybeSingle()
    return data
  }
  if (opts?.productSlug) {
    const { data } = await db
      .from('products')
      .select('id, name, price_amount, currency, product_type')
      .eq('account_id', accountId)
      .eq('slug', opts.productSlug)
      .eq('is_active', true)
      .maybeSingle()
    return data
  }

  const { data: ebook } = await db
    .from('products')
    .select('id, name, price_amount, currency, product_type')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('product_type', 'ebook')
    .gt('price_amount', 0)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (ebook) return ebook

  const { data: anyPaid } = await db
    .from('products')
    .select('id, name, price_amount, currency, product_type')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .gt('price_amount', 0)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return anyPaid
}
