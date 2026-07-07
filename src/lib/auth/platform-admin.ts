import { NextResponse } from 'next/server'

/**
 * Guard for platform-operator routes (assign Gupshup numbers to
 * customer accounts). Authenticated via a shared secret — not a
 * Supabase session.
 */
export function requirePlatformAdmin(request: Request): NextResponse | null {
  const secret = process.env.PLATFORM_ADMIN_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'PLATFORM_ADMIN_SECRET is not configured on this server' },
      { status: 503 },
    )
  }

  const header = request.headers.get('x-platform-admin-secret')
  const auth = request.headers.get('authorization')
  const bearer =
    auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null

  if (header === secret || bearer === secret) {
    return null
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
