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
      .from('products')
      .select('*')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ products: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const slug =
      typeof body.slug === 'string' && body.slug.trim()
        ? body.slug.trim()
        : name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
    const productType = body.product_type ?? 'other'

    if (!name || !slug) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        account_id: accountId,
        name,
        slug,
        product_type: productType,
        description: body.description ?? null,
        short_pitch: body.short_pitch ?? null,
        price_amount: Number(body.price_amount) || 0,
        currency: body.currency || 'INR',
        whatsapp_blurb: body.whatsapp_blurb ?? null,
        faq_bullets: body.faq_bullets ?? null,
        is_active: body.is_active !== false,
        sort_order: Number(body.sort_order) || 0,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ product: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    for (const key of [
      'name',
      'description',
      'short_pitch',
      'whatsapp_blurb',
      'faq_bullets',
      'currency',
      'product_type',
    ] as const) {
      if (typeof body[key] === 'string') patch[key] = body[key]
    }
    if (typeof body.price_amount === 'number') patch.price_amount = body.price_amount
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order

    const { data, error } = await supabase
      .from('products')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ product: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
