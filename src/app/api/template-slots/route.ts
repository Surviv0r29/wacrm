import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('template_slots')
      .select('id, slot_key, label, description, template_name, language')
      .eq('account_id', accountId)
      .order('slot_key')
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ slots: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const slots = Array.isArray(body?.slots) ? body.slots : null
    if (!slots) {
      return NextResponse.json({ error: 'slots array required' }, { status: 400 })
    }

    for (const slot of slots) {
      if (!slot?.id) continue
      const { error } = await supabase
        .from('template_slots')
        .update({
          template_name:
            typeof slot.template_name === 'string' && slot.template_name.trim()
              ? slot.template_name.trim()
              : null,
          language:
            typeof slot.language === 'string' && slot.language.trim()
              ? slot.language.trim()
              : 'en',
          updated_at: new Date().toISOString(),
        })
        .eq('id', slot.id)
        .eq('account_id', accountId)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
