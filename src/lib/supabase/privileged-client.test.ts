import { describe, it, expect, afterEach } from 'vitest'
import {
  mintServiceRoleJwt,
  resetPrivilegedSupabaseClient,
} from './privileged-client'

afterEach(() => {
  resetPrivilegedSupabaseClient()
})

describe('mintServiceRoleJwt', () => {
  it('returns a 3-part JWT signed with HS256', () => {
    const token = mintServiceRoleJwt('test-secret', { projectRef: 'abc123' })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatch(/^eyJ/)

    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8',
      ),
    )
    expect(payload.role).toBe('service_role')
    expect(payload.iss).toBe('supabase')
    expect(payload.ref).toBe('abc123')
    expect(typeof payload.exp).toBe('number')
  })
})
