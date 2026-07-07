import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedTexts, toVectorLiteral, EMBEDDING_DIMENSIONS } from './embeddings'
import { AiError } from './types'

function vector(dim = EMBEDDING_DIMENSIONS, seed = 0): number[] {
  return Array.from({ length: dim }, (_, i) => seed + i * 0.001)
}

function okSingle(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ embedding: { values: vector() } }),
  } as unknown as Response
}

function okBatch(count: number): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      embeddings: Array.from({ length: count }, (_, i) => ({
        values: vector(EMBEDDING_DIMENSIONS, i),
      })),
    }),
  } as unknown as Response
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })
})

describe('embedTexts', () => {
  it('returns [] and makes no request for empty input', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedTexts('AIza-x', [])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds a single batch via batchEmbedContents', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).requests.length
      return okBatch(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await embedTexts('AIza-x', ['a', 'b', 'c'])
    expect(out).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('batchEmbedContents')
    expect(
      (opts as unknown as { headers: Record<string, string> }).headers['x-goog-api-key'],
    ).toBe('AIza-x')
  })

  it('uses embedContent for a single RETRIEVAL_QUERY input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okSingle())
    vi.stubGlobal('fetch', fetchMock)

    const out = await embedTexts('AIza-x', ['query'], { taskType: 'RETRIEVAL_QUERY' })
    expect(out).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toContain('embedContent')
  })

  it('splits large inputs into multiple batches', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).requests.length
      return okBatch(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const inputs = Array.from({ length: 100 }, (_, i) => `t${i}`)
    const out = await embedTexts('AIza-x', inputs)
    expect(out).toHaveLength(100)
    expect(fetchMock).toHaveBeenCalledTimes(2) // 96 + 4
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response),
    )
    await expect(embedTexts('AIza-x', ['a', 'b'])).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })

  it('throws on a malformed batch response (count mismatch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embeddings: [] }),
      } as unknown as Response),
    )
    await expect(embedTexts('AIza-x', ['a', 'b'])).rejects.toBeInstanceOf(AiError)
  })
})
