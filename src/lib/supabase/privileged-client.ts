/**
 * Privileged (RLS-bypassing) Supabase client for webhooks, automations,
 * flows, and platform admin paths that have no end-user session.
 *
 * Resolution order for the API key:
 *   1. SUPABASE_SERVICE_ROLE_KEY — if it looks like a JWT (`eyJ…`)
 *   2. SUPABASE_JWT_SECRET — mint a fresh service_role JWT (fixes
 *      truncated / corrupted keys on servers while using the same Rest API)
 *
 * Logged-in UI CRUD still uses the anon key + user session; it is untouched.
 */

import crypto from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null
let _mintedKey: string | null = null
let _mintedAt = 0

const MINT_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const REMINT_AFTER_MS = (MINT_TTL_SECONDS - 60 * 60) * 1000 // remint 1h early

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

/** HS256 mint of a PostgREST-compatible service_role JWT. */
export function mintServiceRoleJwt(
  jwtSecret: string,
  opts?: { projectRef?: string | null; ttlSeconds?: number },
): string {
  const now = Math.floor(Date.now() / 1000)
  const ttl = opts?.ttlSeconds ?? MINT_TTL_SECONDS
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload: Record<string, unknown> = {
    role: 'service_role',
    iss: 'supabase',
    iat: now,
    exp: now + ttl,
  }
  if (opts?.projectRef) payload.ref = opts.projectRef
  const body = `${header}.${base64urlJson(payload)}`
  const sig = crypto
    .createHmac('sha256', jwtSecret)
    .update(body)
    .digest('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${body}.${sig}`
}

function looksLikeJwt(value: string): boolean {
  const v = value.trim()
  if (!v.startsWith('eyJ')) return false
  const parts = v.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

function resolveServiceKey(): string {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (looksLikeJwt(configured)) return configured

  const secret = process.env.SUPABASE_JWT_SECRET?.trim() ?? ''
  if (!secret) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing or invalid, and SUPABASE_JWT_SECRET is not set. ' +
        'Copy service_role from Supabase → Settings → API, or set SUPABASE_JWT_SECRET (JWT Secret on the same page) so the server can mint a service_role token. ' +
        'Do not put the anon key in SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  const now = Date.now()
  if (_mintedKey && now - _mintedAt < REMINT_AFTER_MS) return _mintedKey

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  _mintedKey = mintServiceRoleJwt(secret, { projectRef: projectRefFromUrl(url) })
  _mintedAt = now
  console.warn(
    '[supabase] Using JWT minted from SUPABASE_JWT_SECRET (SUPABASE_SERVICE_ROLE_KEY was missing/invalid).',
  )
  return _mintedKey
}

/** Shared privileged client — webhook / automations / admin / public API. */
export function createPrivilegedSupabaseClient(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  const key = resolveServiceKey()
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

/** Invalidate the cached client (e.g. after env reload in tests). */
export function resetPrivilegedSupabaseClient(): void {
  _client = null
  _mintedKey = null
  _mintedAt = 0
}
