/**
 * Classify inbound text once, then fire matching `intent_match`
 * automations. Uses the account's Gemini BYO key + Flash Lite.
 */

import type { Automation, IntentMatchTriggerConfig } from '@/types'
import { loadAiConfig } from '@/lib/ai/config'
import {
  classifyIntent,
  INTENT_CLASSIFIER_DEFAULT_MODEL,
  mergeIntentCatalogs,
} from '@/lib/ai/intent'
import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'

export interface IntentDispatchArgs {
  accountId: string
  contactId: string
  conversationId: string
  messageText: string
}

/**
 * Fire-and-forget-safe: never throws.
 */
export async function dispatchIntentAutomations(
  args: IntentDispatchArgs,
): Promise<void> {
  const { accountId, contactId, conversationId, messageText } = args
  if (!messageText.trim()) return

  try {
    const db = supabaseAdmin()

    const { data: rows, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', accountId)
      .eq('trigger_type', 'intent_match')
      .eq('is_active', true)

    if (error) {
      console.error('[automations/intent] fetch failed:', error.message)
      return
    }
    if (!rows?.length) return

    const automations = rows as Automation[]
    const catalogs = automations.map((a) => {
      const cfg = a.trigger_config as IntentMatchTriggerConfig
      return Array.isArray(cfg?.intents) ? cfg.intents : []
    })
    const intents = mergeIntentCatalogs(catalogs)
    if (intents.length === 0) return

    const ai = await loadAiConfig(db, accountId)
    if (!ai) {
      console.warn(
        '[automations/intent] skipping — AI is not active or not configured for account',
        accountId,
      )
      return
    }
    if (ai.provider !== 'gemini') {
      console.warn(
        '[automations/intent] skipping — intent classification requires a Gemini API key (Settings → AI Agents)',
        accountId,
      )
      return
    }

    // Prefer an explicit model on any automation; otherwise Flash Lite.
    const modelOverride = automations
      .map((a) => (a.trigger_config as IntentMatchTriggerConfig)?.model?.trim())
      .find(Boolean)

    const result = await classifyIntent({
      apiKey: ai.apiKey,
      text: messageText,
      intents,
      model: modelOverride || INTENT_CLASSIFIER_DEFAULT_MODEL,
    })

    console.log(
      '[automations/intent] classified',
      JSON.stringify({
        account_id: accountId,
        intent: result.intentId,
        confidence: result.confidence,
        model: modelOverride || INTENT_CLASSIFIER_DEFAULT_MODEL,
      }),
    )

    if (!result.intentId) return

    await runAutomationsForTrigger({
      accountId,
      triggerType: 'intent_match',
      contactId,
      context: {
        message_text: messageText,
        conversation_id: conversationId,
        detected_intent: result.intentId,
        intent_confidence: result.confidence,
        vars: {
          intent: result.intentId,
          intent_confidence: String(result.confidence),
        },
      },
    })
  } catch (err) {
    console.error(
      '[automations/intent] dispatch failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
