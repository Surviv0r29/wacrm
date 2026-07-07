import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchGupshupAppToken,
  isGupshupAuthError,
  resolveGupshupAppCredentials,
  resolveGupshupAppId,
} from './gupshup-auth'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

const APP_UUID = 'bf9ee64c-3d4d-4ac4-8668-732e577007c4'

describe('isGupshupAuthError', () => {
  it('detects common auth failure messages', () => {
    expect(
      isGupshupAuthError(
        'Unauthorised access to the resource. Please review request parameters and headers and retry',
      ),
    ).toBe(true)
    expect(isGupshupAuthError('Authentication Failed')).toBe(true)
  })
})

describe('fetchGupshupAppToken', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the nested app token from the partner token API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          token: { token: 'sk_app_token_123' },
        }),
      }),
    )

    await expect(
      fetchGupshupAppToken(APP_UUID, 'partner-jwt'),
    ).resolves.toBe('sk_app_token_123')
  })
})

describe('resolveGupshupAppCredentials', () => {
  const originalPartnerToken = process.env.GUPSHUP_PARTNER_TOKEN

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    delete process.env.GUPSHUP_PARTNER_TOKEN
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalPartnerToken !== undefined) {
      process.env.GUPSHUP_PARTNER_TOKEN = originalPartnerToken
    } else {
      delete process.env.GUPSHUP_PARTNER_TOKEN
    }
  })

  it('uses GUPSHUP_PARTNER_TOKEN when configured', async () => {
    process.env.GUPSHUP_PARTNER_TOKEN = 'partner-jwt'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          token: { token: 'sk_fresh' },
        }),
      }),
    )

    const creds = await resolveGupshupAppCredentials({
      gupshup_app_id: APP_UUID,
      access_token: 'enc:stale',
    })

    expect(creds).toEqual({ appId: APP_UUID, apiToken: 'sk_fresh' })
  })

  it('falls back to stored app key when partner token fetch returns 403', async () => {
    process.env.GUPSHUP_PARTNER_TOKEN = 'partner-jwt'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 'error',
          message: 'Do not have permission to access api',
        }),
      }),
    )

    const creds = await resolveGupshupAppCredentials({
      gupshup_app_id: APP_UUID,
      access_token: 'stored-sk-key',
    })

    expect(creds).toEqual({ appId: APP_UUID, apiToken: 'stored-sk-key' })
  })

  it('falls back to the stored encrypted api key when partner token is unset', async () => {
    const creds = await resolveGupshupAppCredentials({
      gupshup_app_id: APP_UUID,
      access_token: 'stored-sk-key',
    })

    expect(creds).toEqual({ appId: APP_UUID, apiToken: 'stored-sk-key' })
  })

  it('rejects numeric gupshup_app_id mistaken for phone_number_id', () => {
    expect(() =>
      resolveGupshupAppId({ gupshup_app_id: '207437372456043' }),
    ).toThrow(/phone_number_id/)
  })
})
