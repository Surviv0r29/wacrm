import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  listGupshupTemplates,
  parseGupshupTemplate,
} from '@/lib/whatsapp/gupshup-templates'
import { resolveGupshupAppCredentials } from '@/lib/whatsapp/gupshup-auth'
import { isGupshupProvider } from '@/lib/whatsapp/provider-mode'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

/**
 * Sync message templates from Meta or Gupshup → local message_templates table.
 *
 * Stores upstream status verbatim (APPROVED / PENDING / REJECTED / …) so
 * pending templates remain visible until approved.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

interface TemplateUpsertRow {
  account_id: string
  user_id: string
  name: string
  category: 'Marketing' | 'Utility' | 'Authentication'
  language: string
  header_type: string | null
  header_content: string | null
  header_handle: string | null
  body_text: string
  footer_text: string | null
  buttons: TemplateButton[] | null
  sample_values: TemplateSampleValues | null
  status: ReturnType<typeof normalizeStatus>
  meta_template_id: string
  quality_score: 'GREEN' | 'YELLOW' | 'RED' | null
  rejection_reason?: string | null
  updated_at: string
}

interface SyncUpsertResult {
  inserted: number
  updated: number
  errors: { name: string; language: string; message: string }[]
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
    }
  }
  return out
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

function metaTemplateToRow(
  t: MetaTemplate,
  accountId: string,
  userId: string,
): TemplateUpsertRow {
  const body = (t.components ?? []).find((c) => c.type === 'BODY')
  const header = (t.components ?? []).find((c) => c.type === 'HEADER')
  const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
  const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

  const parsedButtons = parseButtons(buttons?.buttons)
  const sampleValues = extractSampleValues(body, header)

  const headerFormat = header?.format?.toUpperCase()
  const headerType =
    headerFormat === 'TEXT' ||
    headerFormat === 'IMAGE' ||
    headerFormat === 'VIDEO' ||
    headerFormat === 'DOCUMENT'
      ? headerFormat.toLowerCase()
      : null

  return {
    account_id: accountId,
    user_id: userId,
    name: t.name,
    category: normalizeCategory(t.category),
    language: t.language,
    header_type: headerType,
    header_content: header?.text ?? null,
    header_handle: header?.example?.header_handle?.[0] ?? null,
    body_text: body?.text ?? '',
    footer_text: footer?.text ?? null,
    buttons: parsedButtons.length ? parsedButtons : null,
    sample_values: sampleValues,
    status: normalizeStatus(t.status),
    meta_template_id: t.id,
    quality_score: normalizeQualityScore(t.quality_score),
    updated_at: new Date().toISOString(),
  }
}

async function upsertSyncedTemplates(
  supabase: SupabaseClient,
  accountId: string,
  rows: TemplateUpsertRow[],
): Promise<SyncUpsertResult> {
  let inserted = 0
  let updated = 0
  const errors: SyncUpsertResult['errors'] = []

  for (const row of rows) {
    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', row.name)
      .eq('language', row.language)
      .maybeSingle()

    if (lookupErr) {
      errors.push({
        name: row.name,
        language: row.language,
        message: lookupErr.message,
      })
      continue
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('message_templates')
        .update(row)
        .eq('id', existing.id)
      if (updErr) {
        errors.push({
          name: row.name,
          language: row.language,
          message: updErr.message,
        })
      } else {
        updated++
      }
    } else {
      const { error: insErr } = await supabase.from('message_templates').insert(row)
      if (insErr) {
        errors.push({
          name: row.name,
          language: row.language,
          message: insErr.message,
        })
      } else {
        inserted++
      }
    }
  }

  return { inserted, updated, errors }
}

async function syncFromMeta(
  config: { waba_id: string; access_token: string },
  accountId: string,
  userId: string,
): Promise<{
  total: number
  truncated: boolean
  rows: TemplateUpsertRow[]
}> {
  const accessToken = decrypt(config.access_token)

  const metaTemplates: MetaTemplate[] = []
  let nextUrl:
    | string
    | null = `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
  const PAGE_CAP = 20
  let pageCount = 0

  while (nextUrl && pageCount < PAGE_CAP) {
    pageCount++
    const metaRes: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!metaRes.ok) {
      let metaErr = `Meta API error: ${metaRes.status}`
      try {
        const body = await metaRes.json()
        if (body?.error?.message) metaErr = body.error.message
      } catch {
        // keep fallback
      }
      throw new Error(metaErr)
    }

    const metaBody: {
      data?: MetaTemplate[]
      paging?: { next?: string }
    } = await metaRes.json()
    if (metaBody.data) metaTemplates.push(...metaBody.data)
    nextUrl = metaBody.paging?.next ?? null
  }

  return {
    total: metaTemplates.length,
    truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    rows: metaTemplates.map((t) => metaTemplateToRow(t, accountId, userId)),
  }
}

async function syncFromGupshup(
  config: {
    gupshup_app_id: string
    gs_app_id?: string | null
    access_token: string
  },
  accountId: string,
  userId: string,
): Promise<{ total: number; truncated: boolean; rows: TemplateUpsertRow[] }> {
  const { appId, apiToken } = await resolveGupshupAppCredentials(config)
  const gupshupTemplates = await listGupshupTemplates({
    appId,
    apiToken,
  })

  return {
    total: gupshupTemplates.length,
    truncated: false,
    rows: gupshupTemplates.map((t) => {
      const parsed = parseGupshupTemplate(t)
      return {
        account_id: accountId,
        user_id: userId,
        ...parsed,
        header_handle: null,
        updated_at: new Date().toISOString(),
      }
    }),
  }
}

export async function POST() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    const provider = config.provider ?? 'meta'
    let syncResult: { total: number; truncated: boolean; rows: TemplateUpsertRow[] }

    if (isGupshupProvider(provider)) {
      if (!config.gupshup_app_id) {
        return NextResponse.json(
          { error: 'Gupshup app is not assigned to this account yet.' },
          { status: 400 },
        )
      }
      try {
        syncResult = await syncFromGupshup(
          {
            gupshup_app_id: config.gupshup_app_id,
            gs_app_id: config.gs_app_id,
            access_token: config.access_token,
          },
          accountId,
          user.id,
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch Gupshup templates'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    } else {
      if (!config.waba_id) {
        return NextResponse.json(
          {
            error:
              'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
          },
          { status: 400 },
        )
      }
      try {
        syncResult = await syncFromMeta(
          { waba_id: config.waba_id, access_token: config.access_token },
          accountId,
          user.id,
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch Meta templates'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    const { inserted, updated, errors } = await upsertSyncedTemplates(
      supabase,
      accountId,
      syncResult.rows,
    )

    return NextResponse.json({
      success: errors.length === 0,
      provider,
      total: syncResult.total,
      inserted,
      updated,
      pending: syncResult.rows.filter((r) => r.status === 'PENDING').length,
      approved: syncResult.rows.filter((r) => r.status === 'APPROVED').length,
      errors,
      truncated: syncResult.truncated,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
