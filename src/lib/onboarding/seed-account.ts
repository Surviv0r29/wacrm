/**
 * Seed the insurance / ebook / advisory onboarding pack for one account.
 * Idempotent via accounts.onboarding_seeded_at.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps } from '@/lib/automations/steps-tree'
import { getFlowTemplate } from '@/lib/flows/templates'
import { chunkText } from '@/lib/ai/chunk'
import {
  AGENT_DEFAULT_MODEL,
  defaultSalesSystemPrompt,
} from '@/lib/ai/prebuilt-agents'
import { PLATFORM_KNOWLEDGE_PACK } from '@/lib/onboarding/knowledge-pack'
import { PLATFORM_PRODUCT_SEEDS } from '@/lib/onboarding/product-seeds'
import { TEMPLATE_SLOT_SEEDS } from '@/lib/onboarding/template-slots'

const PIPELINE_STAGES = [
  { name: 'New Lead', position: 0, color: '#6366f1' },
  { name: 'Qualified', position: 1, color: '#8b5cf6' },
  { name: 'Proposal Sent', position: 2, color: '#a855f7' },
  { name: 'Negotiation', position: 3, color: '#d946ef' },
  { name: 'Won', position: 4, color: '#22c55e' },
] as const

const AUTOMATION_SLUGS = [
  'insurance_welcome',
  'insurance_intent_router',
  'insurance_follow_up',
] as const

const FLOW_SLUGS = ['advisor_welcome', 'lead_capture'] as const

export interface SeedAccountResult {
  seeded: boolean
  skipped: boolean
  reason?: string
}

export async function seedAccountOnboarding(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
): Promise<SeedAccountResult> {
  const { data: account, error: acctErr } = await db
    .from('accounts')
    .select('id, onboarding_seeded_at')
    .eq('id', accountId)
    .maybeSingle()

  if (acctErr || !account) {
    return { seeded: false, skipped: true, reason: 'account_not_found' }
  }
  if (account.onboarding_seeded_at) {
    return { seeded: false, skipped: true, reason: 'already_seeded' }
  }

  // Products
  for (const p of PLATFORM_PRODUCT_SEEDS) {
    await db.from('products').upsert(
      {
        account_id: accountId,
        name: p.name,
        slug: p.slug,
        product_type: p.product_type,
        description: p.description,
        short_pitch: p.short_pitch,
        price_amount: p.price_amount,
        currency: p.currency,
        whatsapp_blurb: p.whatsapp_blurb,
        faq_bullets: p.faq_bullets,
        sort_order: p.sort_order,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,slug' },
    )
  }

  // Template slots (empty template_name until customer maps)
  for (const slot of TEMPLATE_SLOT_SEEDS) {
    await db.from('template_slots').upsert(
      {
        account_id: accountId,
        slot_key: slot.slot_key,
        label: slot.label,
        description: slot.description,
        language: slot.language,
        template_name: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,slot_key' },
    )
  }

  // Pipeline (if none)
  const { count: pipeCount } = await db
    .from('pipelines')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)

  let pipelineId: string | null = null
  let firstStageId: string | null = null

  if (!pipeCount) {
    const { data: pipe } = await db
      .from('pipelines')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        name: 'Advisor Sales Pipeline',
      })
      .select('id')
      .single()
    pipelineId = pipe?.id ?? null
    if (pipelineId) {
      const stageRows = PIPELINE_STAGES.map((s) => ({
        pipeline_id: pipelineId!,
        name: s.name,
        position: s.position,
        color: s.color,
      }))
      const { data: stages } = await db
        .from('pipeline_stages')
        .insert(stageRows)
        .select('id, position')
      firstStageId =
        stages?.find((s) => s.position === 0)?.id ?? stages?.[0]?.id ?? null
    }
  } else {
    const { data: existing } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    pipelineId = existing?.id ?? null
    if (pipelineId) {
      const { data: stage } = await db
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()
      firstStageId = stage?.id ?? null
    }
  }

  // Knowledge pack (lexical chunks; embeddings when customer adds key)
  for (const doc of PLATFORM_KNOWLEDGE_PACK) {
    const { data: existingDoc } = await db
      .from('ai_knowledge_documents')
      .select('id')
      .eq('account_id', accountId)
      .eq('title', doc.title)
      .maybeSingle()

    let documentId = existingDoc?.id as string | undefined
    if (!documentId) {
      const { data: inserted } = await db
        .from('ai_knowledge_documents')
        .insert({
          account_id: accountId,
          created_by: ownerUserId,
          title: doc.title,
          content: doc.content,
        })
        .select('id')
        .single()
      documentId = inserted?.id
    }
    if (!documentId) continue

    const chunks = chunkText(doc.content)
    await db.from('ai_knowledge_chunks').delete().eq('document_id', documentId)
    if (chunks.length > 0) {
      await db.from('ai_knowledge_chunks').insert(
        chunks.map((content, chunk_index) => ({
          document_id: documentId!,
          account_id: accountId,
          chunk_index,
          content,
        })),
      )
    }
  }

  // AI config placeholder — customer adds Gemini key; Sales prompt + Flash Lite
  const { data: aiExisting } = await db
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!aiExisting) {
    // Placeholder encrypted-looking empty is not valid — skip insert until
    // they save a key. Store prompt preference via a stub only if schema
    // allows empty key — it does NOT (api_key NOT NULL). So we skip.
  } else {
    await db
      .from('ai_configs')
      .update({
        provider: 'gemini',
        model: AGENT_DEFAULT_MODEL,
        system_prompt: defaultSalesSystemPrompt(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
  }

  // Automations (inactive until templates/keys ready — except welcome text)
  for (const slug of AUTOMATION_SLUGS) {
    const template = getTemplate(slug)
    if (!template) continue

    const { data: already } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', template.name)
      .maybeSingle()
    if (already) continue

    const steps = [...template.steps]
    if (slug === 'insurance_welcome' && pipelineId && firstStageId) {
      steps.push({
        step_type: 'create_deal',
        step_config: {
          pipeline_id: pipelineId,
          stage_id: firstStageId,
          title: 'WhatsApp lead — {{ contact.name }}',
          value: 0,
        },
      })
    }

    const { data: automation } = await db
      .from('automations')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        name: template.name,
        description: template.description,
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        // Only welcome is active by default. Intent needs Gemini key;
        // follow-up would block Sales AI while wait-chains run.
        is_active: slug === 'insurance_welcome',
      })
      .select('id')
      .single()

    if (automation?.id) {
      await insertSteps(automation.id, steps as never)
    }
  }

  // Flows (draft status so they don't fight automations until activated)
  for (const slug of FLOW_SLUGS) {
    const template = getFlowTemplate(slug)
    if (!template) continue

    const { data: already } = await db
      .from('flows')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', template.name)
      .maybeSingle()
    if (already) continue

    const { data: flow } = await db
      .from('flows')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        name: template.name,
        description: template.description,
        status: 'draft',
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        entry_node_id: template.entry_node_id,
      })
      .select('id')
      .single()

    if (flow?.id) {
      await db.from('flow_nodes').insert(
        template.nodes.map((n) => ({
          flow_id: flow.id,
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
        })),
      )
    }
  }

  await db
    .from('accounts')
    .update({ onboarding_seeded_at: new Date().toISOString() })
    .eq('id', accountId)

  return { seeded: true, skipped: false }
}
