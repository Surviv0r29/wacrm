import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  assignGupshupAccount,
  AssignGupshupError,
  publicWebhookUrl,
} from './gupshup-assign'

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
}))

function mockDb(overrides: {
  account?: { id: string; owner_user_id: string } | null
  claimed?: { account_id: string } | null
  existing?: { id: string; access_token?: string } | null
  updateError?: Error | null
  insertError?: Error | null
}) {
  const chain = (result: unknown) => ({
    eq: () => chain(result),
    neq: () => chain(result),
    maybeSingle: async () => ({ data: result, error: null }),
    select: () => chain(result),
    from: () => chain(result),
  })

  return {
    from: (table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: overrides.account ?? null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => {
              if (val === 'phone-id') {
                return {
                  neq: () => ({
                    maybeSingle: async () => ({
                      data: overrides.claimed ?? null,
                      error: null,
                    }),
                  }),
                }
              }
              return {
                maybeSingle: async () => ({
                  data: overrides.existing ?? null,
                  error: null,
                }),
              }
            },
          }),
          update: () => ({
            eq: async () => ({ error: overrides.updateError ?? null }),
          }),
          insert: async () => ({ error: overrides.insertError ?? null }),
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('assignGupshupAccount', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com')
  })

  it('requires api_key for new assignments', async () => {
    const db = mockDb({
      account: { id: 'acct-1', owner_user_id: 'user-1' },
      existing: null,
    })

    await expect(
      assignGupshupAccount(db as never, {
        accountId: 'acct-1',
        gupshupAppId: 'app-1',
        phoneNumberId: 'phone-id',
        displayPhoneNumber: '+911234567890',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'api_key is required' })
  })

  it('creates a new gupshup assignment', async () => {
    const db = mockDb({
      account: { id: 'acct-1', owner_user_id: 'user-1' },
      existing: null,
    })

    const result = await assignGupshupAccount(db as never, {
      accountId: 'acct-1',
      gupshupAppId: 'app-1',
      apiKey: 'secret-key',
      phoneNumberId: 'phone-id',
      displayPhoneNumber: '+911234567890',
      gsAppId: 'gs-1',
    })

    expect(result).toEqual({
      accountId: 'acct-1',
      displayPhoneNumber: '+911234567890',
      webhookUrl: 'https://crm.example.com/api/whatsapp/webhook',
      updated: false,
    })
  })

  it('updates without api_key when one is already stored', async () => {
    const db = mockDb({
      account: { id: 'acct-1', owner_user_id: 'user-1' },
      existing: { id: 'cfg-1', access_token: 'enc:old' },
    })

    const result = await assignGupshupAccount(db as never, {
      accountId: 'acct-1',
      gupshupAppId: 'app-2',
      phoneNumberId: 'phone-id',
      displayPhoneNumber: '+919999999999',
    })

    expect(result.updated).toBe(true)
  })

  it('defaults gs_app_id to gupshup_app_id when omitted', async () => {
    const updates: Record<string, unknown>[] = []
    const db = {
      from: (table: string) => {
        if (table === 'accounts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'acct-1', owner_user_id: 'user-1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: async (row: Record<string, unknown>) => {
              updates.push(row)
              return { error: null }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    await assignGupshupAccount(db as never, {
      accountId: 'acct-1',
      gupshupAppId: 'bf9ee64c-3d4d-4ac4-8668-732e577007c4',
      apiKey: 'sk_test',
      phoneNumberId: 'phone-id',
      displayPhoneNumber: '+911234567890',
    })

    expect(updates[0]?.gs_app_id).toBe('bf9ee64c-3d4d-4ac4-8668-732e577007c4')
  })

  it('rejects when phone_number_id is claimed by another account', async () => {
    const db = mockDb({
      account: { id: 'acct-1', owner_user_id: 'user-1' },
      existing: null,
      claimed: { account_id: 'other' },
    })

    await expect(
      assignGupshupAccount(db as never, {
        accountId: 'acct-1',
        gupshupAppId: 'app-1',
        apiKey: 'key',
        phoneNumberId: 'phone-id',
        displayPhoneNumber: '+911234567890',
      }),
    ).rejects.toBeInstanceOf(AssignGupshupError)
  })
})

describe('publicWebhookUrl', () => {
  it('strips trailing slash from site url', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/')
    expect(publicWebhookUrl()).toBe('https://crm.example.com/api/whatsapp/webhook')
  })
})
