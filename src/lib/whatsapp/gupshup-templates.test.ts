import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  listGupshupTemplates,
  parseGupshupTemplate,
  type GupshupTemplate,
} from './gupshup-templates'

const sampleTemplate: GupshupTemplate = {
  id: '00b8d1ed-7af6-4734-a7a1-e3062f21d7df',
  elementName: 'payment_reminder',
  languageCode: 'en',
  status: 'PENDING',
  category: 'UTILITY',
  templateType: 'TEXT',
  data: 'This is to remind you that {{1}} is due by {{2}}.\nThis is footer',
  externalId: '1508119726419684',
  quality: 'UNKNOWN',
  containerMeta: JSON.stringify({
    data: 'This is to remind you that {{1}} is due by {{2}}.',
    footer: 'This is footer',
    header: 'Payment reminder',
    sampleText: 'This is to remind you that rent is due by Friday.',
    buttons: [
      { type: 'URL', text: 'Pay now', url: 'https://example.com/{{1}}', example: ['https://example.com/abc'] },
    ],
  }),
}

describe('parseGupshupTemplate', () => {
  it('maps pending utility templates with header, footer, and buttons', () => {
    const row = parseGupshupTemplate(sampleTemplate)
    expect(row).toMatchObject({
      name: 'payment_reminder',
      language: 'en',
      category: 'Utility',
      status: 'PENDING',
      header_type: 'text',
      header_content: 'Payment reminder',
      body_text: 'This is to remind you that {{1}} is due by {{2}}.',
      footer_text: 'This is footer',
      meta_template_id: '1508119726419684',
      quality_score: null,
    })
    expect(row.buttons).toHaveLength(1)
    expect(row.buttons?.[0]).toMatchObject({ type: 'URL', text: 'Pay now' })
  })

  it('maps submitted status to pending', () => {
    const row = parseGupshupTemplate({ ...sampleTemplate, status: 'SUBMITTED' })
    expect(row.status).toBe('PENDING')
  })

  it('stores rejection reason for rejected templates', () => {
    const row = parseGupshupTemplate({
      ...sampleTemplate,
      status: 'REJECTED',
      reason: 'Invalid Format',
    })
    expect(row.status).toBe('REJECTED')
    expect(row.rejection_reason).toBe('Invalid Format')
  })

  it('maps image template type to header_type image', () => {
    const row = parseGupshupTemplate({
      ...sampleTemplate,
      templateType: 'IMAGE',
      containerMeta: JSON.stringify({ data: 'Body only' }),
    })
    expect(row.header_type).toBe('image')
  })
})

describe('listGupshupTemplates', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('paginates until a short page is returned', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          templates: [{ ...sampleTemplate, elementName: 'page_one' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', templates: [] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const templates = await listGupshupTemplates({
      appId: 'app-1',
      apiToken: 'token',
      pageSize: 1,
    })

    expect(templates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/partner/app/app-1/templates')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('token')
  })

  it('throws on gupshup error payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'error', message: 'Too Many Requests' }),
      }),
    )

    await expect(
      listGupshupTemplates({ appId: 'app-1', apiToken: 'token' }),
    ).rejects.toThrow('Too Many Requests')
  })

  it('falls back to the WA API when the partner API rejects auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          status: 'error',
          message: 'Unauthorised access to the resource',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          templates: [{ ...sampleTemplate, elementName: 'wa_api_template' }],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const templates = await listGupshupTemplates({
      appId: 'app-1',
      apiToken: 'api-key',
    })

    expect(templates).toHaveLength(1)
    expect(templates[0].elementName).toBe('wa_api_template')
    expect(fetchMock.mock.calls[1][0]).toContain('/wa/app/app-1/template')
    expect(fetchMock.mock.calls[1][1].headers.apikey).toBe('api-key')
  })
})
