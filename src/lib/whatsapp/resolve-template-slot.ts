/**
 * Resolve a platform template slot → Meta/Gupshup template name.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedTemplateSlot {
  slotKey: string
  templateName: string
  language: string
}

/**
 * Look up `template_slots` for this account. Returns null if unmapped.
 */
export async function resolveTemplateSlot(
  db: SupabaseClient,
  accountId: string,
  slotKey: string,
): Promise<ResolvedTemplateSlot | null> {
  const key = slotKey.trim()
  if (!key) return null

  const { data, error } = await db
    .from('template_slots')
    .select('slot_key, template_name, language')
    .eq('account_id', accountId)
    .eq('slot_key', key)
    .maybeSingle()

  if (error) {
    console.error('[template-slot] lookup failed:', error.message)
    return null
  }
  if (!data?.template_name?.trim()) return null

  return {
    slotKey: data.slot_key,
    templateName: data.template_name.trim(),
    language: data.language?.trim() || 'en',
  }
}

/**
 * If `templateName` looks like a slot key (no spaces, known prefix or
 * matches a slot_key row), resolve it. Otherwise treat as literal name.
 *
 * Convention: prefer explicit `template_slot` config; also accept
 * `slot:welcome` prefix on template_name for backward-friendly configs.
 */
export async function resolveTemplateNameOrSlot(
  db: SupabaseClient,
  accountId: string,
  opts: {
    templateName?: string | null
    templateSlot?: string | null
    language?: string | null
  },
): Promise<{ templateName: string; language: string } | null> {
  const slotKey =
    opts.templateSlot?.trim() ||
    (opts.templateName?.startsWith('slot:')
      ? opts.templateName.slice(5).trim()
      : null)

  if (slotKey) {
    const resolved = await resolveTemplateSlot(db, accountId, slotKey)
    if (!resolved) return null
    return {
      templateName: resolved.templateName,
      language: opts.language?.trim() || resolved.language,
    }
  }

  const name = opts.templateName?.trim()
  if (!name) return null

  // Bare slot_key without "slot:" — if a slot row exists with this key, use it.
  const asSlot = await resolveTemplateSlot(db, accountId, name)
  if (asSlot) {
    return {
      templateName: asSlot.templateName,
      language: opts.language?.trim() || asSlot.language,
    }
  }

  return {
    templateName: name,
    language: opts.language?.trim() || 'en',
  }
}
