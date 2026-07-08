import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createPrivilegedSupabaseClient } from '@/lib/supabase/privileged-client'

// Lazy, shared privileged client for the Flows engine.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    try {
      _adminClient = createPrivilegedSupabaseClient()
    } catch {
      // Fall through to legacy env-only create for clearer errors in tests.
      _adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    }
  }
  return _adminClient
}
