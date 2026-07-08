import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createPrivilegedSupabaseClient } from '@/lib/supabase/privileged-client'

// Lazy, shared privileged client for the AI auto-reply path.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    try {
      _adminClient = createPrivilegedSupabaseClient()
    } catch {
      _adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    }
  }
  return _adminClient
}
