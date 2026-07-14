import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyIntent,
  INTENT_CLASSIFIER_DEFAULT_MODEL,
  intentIdsFromConfig,
  mergeIntentCatalogs,
  slugifyIntentId,
} from './intent'

describe('slugifyIntentId', () => {
  it('normalizes labels', () => {
    expect(slugifyIntentId('Talk to Sales!')).toBe('talk_to_sales')
  })
})

describe('mergeIntentCatalogs', () => {
  it('dedupes by id case-insensitively', () => {
    const merged = mergeIntentCatalogs([
      [{ id: 'Pricing', label: 'Pricing' }],
      [{ id: 'pricing', label: 'Later' }, { id: 'support', label: 'Support' }],
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0].label).toBe('Pricing')
    expect(merged[1].id).toBe('support')
  })
})

describe('intentIdsFromConfig', () => {
  it('returns lowercased ids', () => {
    expect(
      intentIdsFromConfig({
        intents: [
          { id: 'Pricing', label: 'Pricing' },
          { id: ' support ', label: 'Support' },
        ],
      }),
    ).toEqual(['pricing', 'support'])
  })
})

describe('classifyIntent', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('posts Flash Lite classification request and maps the intent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ intent: 'pricing', confidence: 0.91 }) }],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await classifyIntent({
      apiKey: 'key',
      text: 'How much does the plan cost?',
      intents: [
        { id: 'pricing', label: 'Pricing' },
        { id: 'support', label: 'Support' },
      ],
    })

    expect(result).toMatchObject({ intentId: 'pricing', confidence: 0.91 })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain(`models/${INTENT_CLASSIFIER_DEFAULT_MODEL}:generateContent`)
    expect(opts.headers['x-goog-api-key']).toBe('key')
    const body = JSON.parse(opts.body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('returns null for none/unknown intents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ intent: 'none', confidence: 0.4 }) }],
              },
            },
          ],
        }),
      }),
    )

    const result = await classifyIntent({
      apiKey: 'key',
      text: 'ok',
      intents: [{ id: 'pricing', label: 'Pricing' }],
    })
    expect(result.intentId).toBeNull()
  })
})
