import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const stage = new URL(request.url).searchParams.get('stage')
    let q = supabase
      .from('leads')
      .select(
        '*, contacts(id, name, phone, email), products(id, name, product_type)',
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (stage) q = q.eq('stage', stage)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ leads: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const contactId =
      typeof body?.contact_id === 'string' ? body.contact_id : ''
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('leads')
      .upsert(
        {
          account_id: accountId,
          contact_id: contactId,
          conversation_id: body.conversation_id ?? null,
          product_id: body.product_id ?? null,
          deal_id: body.deal_id ?? null,
          stage: body.stage ?? 'new',
          interest: body.interest ?? 'unknown',
          source: body.source ?? 'whatsapp',
          notes: body.notes ?? null,
          last_touch_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,contact_id' },
      )
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ lead: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_touch_at: new Date().toISOString(),
    }
    if (typeof body.stage === 'string') patch.stage = body.stage
    if (typeof body.interest === 'string') patch.interest = body.interest
    if (typeof body.notes === 'string') patch.notes = body.notes
    if (typeof body.score === 'number') patch.score = body.score
    if (body.product_id === null || typeof body.product_id === 'string') {
      patch.product_id = body.product_id
    }

    const { data, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ lead: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
