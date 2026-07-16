import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { seedAccountOnboarding } from '@/lib/onboarding/seed-account'

/**
 * POST /api/onboarding/seed
 *
 * Idempotent: seeds the insurance/advisor pack once per account.
 * Called from the dashboard shell on first load.
 */
export async function POST() {
  try {
    const { accountId, userId } = await getCurrentAccount()
    const result = await seedAccountOnboarding(
      supabaseAdmin(),
      accountId,
      userId,
    )
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data } = await supabase
      .from('accounts')
      .select('onboarding_seeded_at')
      .eq('id', accountId)
      .maybeSingle()
    return NextResponse.json({
      seeded: Boolean(data?.onboarding_seeded_at),
      onboarding_seeded_at: data?.onboarding_seeded_at ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
