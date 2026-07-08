/**
 * Optional Postgres pool for privileged server paths when Rest API keys
 * are broken but DATABASE_URL (Supabase Session / direct URI) works.
 *
 * Used today as a fallback for inbound WhatsApp config routing.
 */

import { Pool, type QueryResultRow } from 'pg'

let _pool: Pool | null = null

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getPgPool(): Pool {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      ssl:
        url.includes('localhost') || url.includes('127.0.0.1')
          ? undefined
          : { rejectUnauthorized: false },
    })
  }
  return _pool
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPgPool().query<T>(text, params)
  return result.rows
}
