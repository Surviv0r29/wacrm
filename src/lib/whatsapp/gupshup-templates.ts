/**
 * Gupshup Partner — template list + mapping to local message_templates rows.
 *
 * Partner: GET /partner/app/{appId}/templates
 * WA API:  GET /wa/app/{appId}/template  (apikey header)
 */

import type { TemplateButton, TemplateSampleValues } from '@/types'
import { isGupshupAuthError } from '@/lib/whatsapp/gupshup-auth'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'

const GUPSHUP_PARTNER_BASE =
  process.env.GUPSHUP_PARTNER_API_BASE ?? 'https://partner.gupshup.io'
const GUPSHUP_WA_API_BASE =
  process.env.GUPSHUP_WA_API_BASE ?? 'https://api.gupshup.io'

export interface GupshupTemplate {
  id: string
  elementName: string
  languageCode: string
  status: string
  category: string
  templateType: string
  data?: string
  containerMeta?: string
  meta?: string
  externalId?: string
  quality?: string
  reason?: string
}

interface GupshupContainerMeta {
  data?: string
  header?: string
  footer?: string
  sampleText?: string
  buttons?: GupshupButton[]
}

interface GupshupButton {
  type?: string
  text?: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface GupshupListResponse {
  status?: string
  message?: string
  templates?: GupshupTemplate[]
}

async function fetchPartnerTemplatePage(
  appId: string,
  apiToken: string,
  pageNo: number,
  pageSize: number,
): Promise<GupshupTemplate[]> {
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  })
  const url = `${GUPSHUP_PARTNER_BASE}/partner/app/${appId}/templates?${params}`

  const response = await fetch(url, {
    headers: { Authorization: apiToken },
  })

  if (!response.ok) {
    let message = `Gupshup API error: ${response.status}`
    try {
      const body = (await response.json()) as GupshupListResponse
      if (body.message) message = body.message
    } catch {
      // keep fallback
    }
    throw new Error(message)
  }

  const body = (await response.json()) as GupshupListResponse
  if (body.status === 'error') {
    throw new Error(body.message ?? 'Gupshup template list failed')
  }

  return body.templates ?? []
}

async function fetchWaTemplatePage(
  appId: string,
  apiToken: string,
  pageNo: number,
  pageSize: number,
): Promise<GupshupTemplate[]> {
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  })
  const url = `${GUPSHUP_WA_API_BASE}/wa/app/${appId}/template?${params}`

  const response = await fetch(url, {
    headers: { apikey: apiToken },
  })

  if (!response.ok) {
    let message = `Gupshup WA API error: ${response.status}`
    try {
      const body = (await response.json()) as GupshupListResponse
      if (body.message) message = body.message
    } catch {
      // keep fallback
    }
    throw new Error(message)
  }

  const body = (await response.json()) as GupshupListResponse
  if (body.status === 'error') {
    throw new Error(body.message ?? 'Gupshup template list failed')
  }

  return body.templates ?? []
}

async function fetchTemplatePage(
  appId: string,
  apiToken: string,
  pageNo: number,
  pageSize: number,
  useWaApi: boolean,
): Promise<GupshupTemplate[]> {
  return useWaApi
    ? fetchWaTemplatePage(appId, apiToken, pageNo, pageSize)
    : fetchPartnerTemplatePage(appId, apiToken, pageNo, pageSize)
}

async function listFromApi(
  appId: string,
  apiToken: string,
  pageSize: number,
  useWaApi: boolean,
): Promise<GupshupTemplate[]> {
  const all: GupshupTemplate[] = []
  const PAGE_CAP = 50
  let pageNo = 0

  while (pageNo < PAGE_CAP) {
    const page = await fetchTemplatePage(appId, apiToken, pageNo, pageSize, useWaApi)
    all.push(...page)
    if (page.length < pageSize) break
    pageNo++
  }

  return all
}

function parseJsonField<T>(raw: string | undefined): T | null {
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function normalizeCategory(
  raw: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = raw.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: string | undefined,
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const upper = (raw ?? '').toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(raw: GupshupButton[] | undefined): TemplateButton[] {
  if (!raw?.length) return []
  const out: TemplateButton[] = []
  for (const b of raw) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        if (b.text) out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text ?? '',
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text ?? '',
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text ?? '',
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
    }
  }
  return out
}

function extractBodyFromData(data: string | undefined, footer: string | null): string {
  if (!data) return ''
  if (!footer) return data
  const suffix = `\n${footer}`
  return data.endsWith(suffix) ? data.slice(0, -suffix.length) : data
}

export interface ParsedGupshupTemplateRow {
  name: string
  category: 'Marketing' | 'Utility' | 'Authentication'
  language: string
  header_type: 'text' | 'image' | 'video' | 'document' | null
  header_content: string | null
  body_text: string
  footer_text: string | null
  buttons: TemplateButton[] | null
  sample_values: TemplateSampleValues | null
  status: ReturnType<typeof normalizeStatus>
  meta_template_id: string
  quality_score: 'GREEN' | 'YELLOW' | 'RED' | null
  rejection_reason: string | null
}

/** Map a Gupshup template payload into message_templates column shape. */
export function parseGupshupTemplate(t: GupshupTemplate): ParsedGupshupTemplateRow {
  const container = parseJsonField<GupshupContainerMeta>(t.containerMeta)
  const meta = parseJsonField<{ example?: string }>(t.meta)

  const footer = container?.footer ?? null
  const bodyText =
    container?.data ??
    extractBodyFromData(t.data, footer)

  const templateType = t.templateType?.toUpperCase() ?? 'TEXT'
  let headerType: ParsedGupshupTemplateRow['header_type'] = null
  let headerContent: string | null = null

  if (templateType === 'TEXT' && container?.header) {
    headerType = 'text'
    headerContent = container.header
  } else if (
    templateType === 'IMAGE' ||
    templateType === 'VIDEO' ||
    templateType === 'DOCUMENT'
  ) {
    headerType = templateType.toLowerCase() as 'image' | 'video' | 'document'
    headerContent = container?.header ?? null
  }

  const buttons = parseButtons(container?.buttons)
  const sampleValues: TemplateSampleValues | null =
    container?.sampleText || meta?.example
      ? { body: container?.sampleText ? [container.sampleText] : undefined }
      : null

  const status = normalizeStatus(t.status)
  const rejectionReason =
    status === 'REJECTED' && t.reason?.trim() ? t.reason.trim() : null

  return {
    name: t.elementName,
    category: normalizeCategory(t.category),
    language: t.languageCode,
    header_type: headerType,
    header_content: headerContent,
    body_text: bodyText,
    footer_text: footer,
    buttons: buttons.length ? buttons : null,
    sample_values: sampleValues,
    status,
    meta_template_id: t.externalId?.trim() || t.id,
    quality_score: normalizeQualityScore(t.quality),
    rejection_reason: rejectionReason,
  }
}

export interface ListGupshupTemplatesArgs {
  appId: string
  apiToken: string
  pageSize?: number
}

/** Fetch all templates for a Gupshup app (includes pending / rejected). */
export async function listGupshupTemplates(
  args: ListGupshupTemplatesArgs,
): Promise<GupshupTemplate[]> {
  const { appId, apiToken, pageSize = 100 } = args

  try {
    return await listFromApi(appId, apiToken, pageSize, false)
  } catch (partnerErr) {
    const partnerMessage =
      partnerErr instanceof Error ? partnerErr.message : 'Partner API failed'
    if (!isGupshupAuthError(partnerMessage)) {
      throw partnerErr
    }

    try {
      return await listFromApi(appId, apiToken, pageSize, true)
    } catch (waErr) {
      const waMessage = waErr instanceof Error ? waErr.message : 'WA API failed'
      throw new Error(
        `Gupshup template sync failed. Partner API: ${partnerMessage}. WA API: ${waMessage}. ` +
          'Verify gupshup_app_id and the app API key, or set GUPSHUP_PARTNER_TOKEN to fetch tokens automatically.',
      )
    }
  }
}
