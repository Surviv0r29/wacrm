import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Embeddings (Gemini).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval. Accounts
// supply a Gemini API key (possibly the same as the chat key). 1536-dim
// output matches the `vector(1536)` column in migration 030.
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const EMBEDDING_MODEL = 'gemini-embedding-001'

export const EMBEDDING_DIMENSIONS = 1536

// Keep the export name for callers that reference the model id.
export { EMBEDDING_MODEL }

const BATCH_SIZE = 96

interface GeminiEmbedResponse {
  embedding?: { values?: number[] }
}

interface GeminiBatchEmbedResponse {
  embeddings?: { values?: number[] }[]
}

function embeddingModelPath(): string {
  return `models/${EMBEDDING_MODEL}`
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

async function embedOne(
  apiKey: string,
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  timeoutMs: number,
): Promise<number[]> {
  const url = `${GEMINI_API_BASE}/${embeddingModelPath()}:embedContent`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini embeddings', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiEmbedResponse | null
  const values = data?.embedding?.values
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new AiError('Embeddings response was malformed.', {
      code: 'embeddings_malformed',
    })
  }
  return values
}

async function embedBatch(
  apiKey: string,
  inputs: string[],
  timeoutMs: number,
): Promise<number[][]> {
  const url = `${GEMINI_API_BASE}/${embeddingModelPath()}:batchEmbedContents`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: inputs.map((text) => ({
          model: embeddingModelPath(),
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini embeddings', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiBatchEmbedResponse | null
  const rows = data?.embeddings
  if (!rows || rows.length !== inputs.length) {
    throw new AiError('Embeddings response was malformed.', {
      code: 'embeddings_malformed',
    })
  }

  return rows.map((row) => {
    const values = row.values
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new AiError('Embeddings response missing a vector.', {
        code: 'embeddings_malformed',
      })
    }
    return values
  })
}

/**
 * Embed a list of strings, preserving input order. Batched; throws
 * `AiError` on provider/network failure so callers can decide whether
 * to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
  opts: { taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' } = {},
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const timeoutMs = aiRequestTimeoutMs()
  const taskType = opts.taskType ?? 'RETRIEVAL_DOCUMENT'

  if (inputs.length === 1 && taskType === 'RETRIEVAL_QUERY') {
    return [await embedOne(apiKey, inputs[0], taskType, timeoutMs)]
  }

  const out: number[][] = []
  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)
    if (batch.length === 1) {
      out.push(await embedOne(apiKey, batch[0], taskType, timeoutMs))
    } else {
      out.push(...(await embedBatch(apiKey, batch, timeoutMs)))
    }
  }

  return out
}
