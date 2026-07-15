import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendGupshupTextMessage } from './gupshup-api'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('sendGupshupTextMessage', () => {
  it('posts to the partner v3 message endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'gs-msg-1' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendGupshupTextMessage({
      appId: 'app-123',
      apiToken: 'token-abc',
      to: '919876543210',
      text: 'Hello',
    })

    expect(result).toEqual({ messageId: 'gs-msg-1' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/partner/app/app-123/v3/message')
    expect(opts.headers.Authorization).toBe('token-abc')
    const body = JSON.parse(opts.body)
    expect(body.type).toBe('text')
    expect(body.text.body).toBe('Hello')
  })

  it('includes reply context when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'gs-msg-2' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await sendGupshupTextMessage({
      appId: 'app-123',
      apiToken: 'token-abc',
      to: '919876543210',
      text: 'Reply',
      contextMessageId: 'wamid.prev',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.context).toEqual({ message_id: 'wamid.prev' })
  })

  it('prefers Self-Serve WA API when source phone + app name are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'submitted', messageId: 'ss-msg-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendGupshupTextMessage({
      appId: 'app-123',
      apiToken: 'console-apikey',
      to: '919876543210',
      text: 'Hello',
      selfServe: {
        sourcePhone: '+918375031069',
        appName: 'MyApp',
      },
    })

    expect(result.messageId).toBe('ss-msg-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/wa/api/v1/msg')
    expect(opts.headers.apikey).toBe('console-apikey')
    expect(opts.body).toContain('src.name=MyApp')
    expect(opts.body).toContain('source=918375031069')
  })

  it('hints when V3 fails and Self-Serve is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Please review the request parameters and retry',
        }),
      }),
    )

    await expect(
      sendGupshupTextMessage({
        appId: 'app-123',
        apiToken: 'sk_bad',
        to: '919876543210',
        text: 'Hi',
      }),
    ).rejects.toThrow(/Self-Serve fallback skipped/)
  })

  it('throws on non-param V3 failure when no self-serve context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal Server Error', status: 'error' }),
      }),
    )

    await expect(
      sendGupshupTextMessage({
        appId: 'app-123',
        apiToken: 'bad',
        to: '919876543210',
        text: 'Hi',
      }),
    ).rejects.toThrow(/Internal Server Error/)
  })
})

describe('sendGupshupTemplateMessage', () => {
  it('posts type=template with name and language', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'gs-tpl-1' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sendGupshupTemplateMessage } = await import('./gupshup-api')
    const result = await sendGupshupTemplateMessage({
      appId: 'app-123',
      apiToken: 'token-abc',
      to: '919876543210',
      templateName: 'hello_world',
      language: 'en',
      params: ['Alice'],
    })

    expect(result).toEqual({ messageId: 'gs-tpl-1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe('template')
    expect(body.template).toEqual({
      name: 'hello_world',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Alice' }],
        },
      ],
    })
  })
})

describe('sendGupshupMediaMessage', () => {
  it('posts image with caption to v3 message endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'gs-img-1' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sendGupshupMediaMessage } = await import('./gupshup-api')
    const result = await sendGupshupMediaMessage({
      appId: 'app-123',
      apiToken: 'token-abc',
      to: '919876543210',
      kind: 'image',
      link: 'https://example.com/photo.jpg',
      caption: 'Check this out',
    })

    expect(result).toEqual({ messageId: 'gs-img-1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe('image')
    expect(body.image).toEqual({
      link: 'https://example.com/photo.jpg',
      caption: 'Check this out',
    })
  })

  it('posts audio without caption', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'gs-aud-1' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sendGupshupMediaMessage } = await import('./gupshup-api')
    await sendGupshupMediaMessage({
      appId: 'app-123',
      apiToken: 'token-abc',
      to: '919876543210',
      kind: 'audio',
      link: 'https://example.com/voice.ogg',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.type).toBe('audio')
    expect(body.audio).toEqual({ link: 'https://example.com/voice.ogg' })
    expect(body.audio.caption).toBeUndefined()
  })
})

describe('buildGupshupSelfServeTemplateParams', () => {
  it('flattens header + body + URL button params in occurrence order', async () => {
    const { buildGupshupSelfServeTemplateParams } = await import('./gupshup-api')
    const params = buildGupshupSelfServeTemplateParams(
      {
        id: 't1',
        user_id: 'u1',
        name: 'welcome',
        body_text: 'Hi {{1}}, welcome to {{2}}',
        header_type: 'text',
        header_content: 'Hello {{1}}',
        buttons: [
          { type: 'URL', text: 'Open', url: 'https://example.com/{{1}}' },
        ],
        created_at: new Date().toISOString(),
      },
      {
        headerText: 'Team',
        body: ['Alex', 'Acme'],
        buttonParams: { 0: 'promo' },
      },
    )
    expect(params).toEqual(['Team', 'Alex', 'Acme', 'promo'])
  })
})

describe('sendGupshupTemplateMessage Self-Serve', () => {
  it('POSTs form-urlencoded /wa/api/v1/template/msg with Gupshup UUID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ status: 'submitted', messageId: 'ss-tpl-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sendGupshupTemplateMessage } = await import('./gupshup-api')
    const result = await sendGupshupTemplateMessage({
      appId: 'app-123',
      apiToken: 'sk_partner_token',
      to: '919876543210',
      templateName: 'welcome_message',
      language: 'en',
      template: {
        id: 'row1',
        user_id: 'u1',
        name: 'welcome_message',
        body_text: 'Hi {{1}}',
        meta_template_id: '81eeb971-6d09-4986-8346-f6ba713a1ec0',
        created_at: new Date().toISOString(),
      },
      messageParams: { body: ['Alex'] },
      selfServe: {
        sourcePhone: '918282095942',
        appName: 'DigiGlobal',
        apiKey: 'consolehexapikey123',
      },
    })

    expect(result.messageId).toBe('ss-tpl-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/wa/api/v1/template/msg')
    expect(opts.headers.apikey).toBe('consolehexapikey123')
    expect(opts.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
    const form = new URLSearchParams(opts.body)
    expect(form.get('source')).toBe('918282095942')
    expect(form.get('destination')).toBe('919876543210')
    expect(form.get('src.name')).toBe('DigiGlobal')
    expect(JSON.parse(form.get('template')!)).toEqual({
      id: '81eeb971-6d09-4986-8346-f6ba713a1ec0',
      params: ['Alex'],
    })
  })

  it('skips Self-Serve when template id is a Meta numeric id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'v3-tpl-1' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sendGupshupTemplateMessage } = await import('./gupshup-api')
    await sendGupshupTemplateMessage({
      appId: 'a471d262-1c6b-482b-a8b2-25613ddaecb1',
      apiToken: 'sk_partner_token',
      to: '919876543210',
      templateName: 'instant_welcome',
      language: 'en',
      template: {
        id: 'row2',
        user_id: 'u1',
        name: 'instant_welcome',
        body_text: 'Hello',
        meta_template_id: '1332403871780452',
        created_at: new Date().toISOString(),
      },
      selfServe: {
        sourcePhone: '918282095942',
        appName: 'DigiGlobal',
        apiKey: 'consolehexapikey123',
      },
    })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/wa/api/v1/template/msg'))).toBe(false)
    expect(urls.some((u) => u.includes('/v3/message'))).toBe(true)
  })
})
