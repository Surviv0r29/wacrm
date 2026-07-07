const STORAGE_KEY = 'wacrm_platform_admin_secret'

export function getPlatformAdminSecret(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(STORAGE_KEY)
}

export function setPlatformAdminSecret(secret: string): void {
  sessionStorage.setItem(STORAGE_KEY, secret)
}

export function clearPlatformAdminSecret(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

export async function platformAdminFetch(
  path: string,
  init: RequestInit = {},
  secretOverride?: string,
): Promise<Response> {
  const secret = secretOverride ?? getPlatformAdminSecret()
  if (!secret) {
    throw new Error('Platform admin not authenticated')
  }

  const headers = new Headers(init.headers)
  headers.set('x-platform-admin-secret', secret)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(path, { ...init, headers })
}
