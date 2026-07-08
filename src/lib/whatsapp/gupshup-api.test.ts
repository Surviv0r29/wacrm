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

  it('falls back to Self-Serve WA API when V3 rejects parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Please review the request parameters and retry',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Please review the request parameters and retry',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Please review the request parameters and retry',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Please review the request parameters and retry',
        }),
      })
      .mockResolvedValueOnce({
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
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(lastCall[0]).toContain('/wa/api/v1/msg')
    expect(lastCall[1].headers.apikey).toBe('console-apikey')
    expect(lastCall[1].body).toContain('src.name=MyApp')
    expect(lastCall[1].body).toContain('source=918375031069')
  })

  it('throws on auth failure when no self-serve context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Authentication Failed', status: 'error' }),
      }),
    )

    await expect(
      sendGupshupTextMessage({
        appId: 'app-123',
        apiToken: 'bad',
        to: '919876543210',
        text: 'Hi',
      }),
    ).rejects.toThrow(/Authentication Failed/)
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
