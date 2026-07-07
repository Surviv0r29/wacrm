import { createClient } from '@supabase/supabase-js'

export function supabaseServiceAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface AdminAccountRow {
  id: string
  name: string
  created_at: string
  owner: {
    user_id: string
    full_name: string
    email: string
  }
  whatsapp: {
    provider: string
    status: string
    display_phone_number: string | null
    gupshup_app_id: string | null
    gs_app_id: string | null
    phone_number_id: string | null
    has_api_key: boolean
    connected_at: string | null
  } | null
}

export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const db = supabaseServiceAdmin()

  const { data: accounts, error: accountsErr } = await db
    .from('accounts')
    .select('id, name, created_at, owner_user_id')
    .order('created_at', { ascending: false })

  if (accountsErr) {
    console.error('[admin/accounts] list:', accountsErr)
    throw new Error('Failed to list accounts')
  }

  if (!accounts?.length) return []

  const ownerIds = accounts.map((a) => a.owner_user_id)

  const [{ data: profiles }, { data: configs }] = await Promise.all([
    db.from('profiles').select('user_id, full_name, email').in('user_id', ownerIds),
    db
      .from('whatsapp_config')
      .select(
        'account_id, provider, status, display_phone_number, gupshup_app_id, gs_app_id, phone_number_id, access_token, connected_at',
      )
      .in(
        'account_id',
        accounts.map((a) => a.id),
      ),
  ])

  const profileByUser = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, p]),
  )
  const configByAccount = new Map(
    (configs ?? []).map((c) => [c.account_id as string, c]),
  )

  return accounts.map((account) => {
    const profile = profileByUser.get(account.owner_user_id)
    const cfg = configByAccount.get(account.id)
    return {
      id: account.id,
      name: account.name,
      created_at: account.created_at,
      owner: {
        user_id: account.owner_user_id,
        full_name: (profile?.full_name as string) ?? 'Unknown',
        email: (profile?.email as string) ?? '',
      },
      whatsapp: cfg
        ? {
            provider: cfg.provider as string,
            status: cfg.status as string,
            display_phone_number: cfg.display_phone_number as string | null,
            gupshup_app_id: cfg.gupshup_app_id as string | null,
            gs_app_id: cfg.gs_app_id as string | null,
            phone_number_id: cfg.phone_number_id as string | null,
            has_api_key: Boolean(cfg.access_token),
            connected_at: cfg.connected_at as string | null,
          }
        : null,
    }
  })
}

export async function getGupshupAssignment(accountId: string) {
  const db = supabaseServiceAdmin()
  const { data, error } = await db
    .from('whatsapp_config')
    .select(
      'account_id, provider, status, display_phone_number, gupshup_app_id, gs_app_id, phone_number_id, access_token, connected_at',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[admin/gupshup] get assignment:', error)
    throw new Error('Failed to load assignment')
  }
  if (!data) return null

  return {
    account_id: data.account_id,
    provider: data.provider,
    status: data.status,
    display_phone_number: data.display_phone_number,
    gupshup_app_id: data.gupshup_app_id,
    gs_app_id: data.gs_app_id,
    phone_number_id: data.phone_number_id,
    has_api_key: Boolean(data.access_token),
    connected_at: data.connected_at,
  }
}
