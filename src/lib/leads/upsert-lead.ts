/**
 * Upsert a WhatsApp lead for (account_id, contact_id).
 * Idempotent — refreshes conversation + last_touch on every inbound.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LeadInterest = 'ebook' | 'insurance' | 'advisory' | 'unknown'
export type LeadStage =
  | 'new'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'nurture'

export interface UpsertLeadInput {
  accountId: string
  contactId: string
  conversationId?: string | null
  productId?: string | null
  dealId?: string | null
  stage?: LeadStage
  interest?: LeadInterest
  source?: string
  notes?: string | null
  /** When true, do not overwrite an existing stage with `new`. */
  preserveStage?: boolean
}

export async function upsertLead(
  db: SupabaseClient,
  input: UpsertLeadInput,
): Promise<{ id: string } | null> {
  const {
    accountId,
    contactId,
    conversationId = null,
    productId = null,
    dealId = null,
    stage = 'new',
    interest = 'unknown',
    source = 'whatsapp',
    notes = null,
    preserveStage = true,
  } = input

  const now = new Date().toISOString()

  const { data: existing } = await db
    .from('leads')
    .select('id, stage')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      last_touch_at: now,
      updated_at: now,
    }
    if (conversationId) patch.conversation_id = conversationId
    if (productId) patch.product_id = productId
    if (dealId) patch.deal_id = dealId
    if (notes) patch.notes = notes
    if (interest && interest !== 'unknown') patch.interest = interest
    if (!preserveStage || !existing.stage) patch.stage = stage

    const { data, error } = await db
      .from('leads')
      .update(patch)
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error) {
      console.error('[leads/upsert] update failed:', error.message)
      return null
    }
    return data
  }

  const { data, error } = await db
    .from('leads')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      product_id: productId,
      deal_id: dealId,
      stage,
      interest,
      source,
      notes,
      last_touch_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[leads/upsert] insert failed:', error.message)
    return null
  }
  return data
}

/**
 * Infer interest from free text (menu replies, intent labels, etc.).
 */
export function inferLeadInterest(text: string | null | undefined): LeadInterest {
  if (!text) return 'unknown'
  const t = text.toLowerCase()
  if (/\b(ebook|e-book|digital product|learning|training)\b/.test(t)) return 'ebook'
  if (/\b(insurance|term|health|policy|premium|cover)\b/.test(t)) return 'insurance'
  if (/\b(advisor|advisory|wealth|rm|relationship manager|financial)\b/.test(t)) {
    return 'advisory'
  }
  if (t === '1' || t.includes('ebook')) return 'ebook'
  if (t === '2' || t.includes('insurance')) return 'insurance'
  if (t === '3' || t.includes('advisor') || t.includes('rm')) return 'advisory'
  return 'unknown'
}
