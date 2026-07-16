'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Product {
  id: string
  name: string
  slug: string
  product_type: string
  short_pitch: string | null
  price_amount: number
  currency: string
  is_active: boolean
  whatsapp_blurb: string | null
}

export default function ProductsPage() {
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])
  const [payProduct, setPayProduct] = useState<Product | null>(null)
  const [contactId, setContactId] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/products')
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to load products')
        return
      }
      setProducts(data.products ?? [])
    } catch {
      toast.error('Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggleActive = async (product: Product) => {
    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, is_active: !product.is_active }),
    })
    if (!res.ok) {
      toast.error('Failed to update product')
      return
    }
    toast.success(product.is_active ? 'Product deactivated' : 'Product activated')
    void load()
  }

  const sendPaymentLink = async () => {
    if (!payProduct || !contactId.trim()) {
      toast.error('Contact ID is required')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/payments/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId.trim(),
          product_id: payProduct.id,
          conversation_id: conversationId.trim() || undefined,
          send_whatsapp: Boolean(conversationId.trim()),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to create payment link')
        return
      }
      toast.success(
        data.payment_link?.short_url
          ? `Link created: ${data.payment_link.short_url}`
          : 'Payment link created',
      )
      setPayProduct(null)
      setContactId('')
      setConversationId('')
    } catch {
      toast.error('Failed to create payment link')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Products & services
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalog shared with Sales and Closer agents — ebooks, insurance lines, and
          advisory packages.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Package className="size-8 opacity-50" />
            <p>No products yet. Visit the dashboard once to seed the default catalog.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base text-foreground">{p.name}</CardTitle>
                  <Badge variant="outline">{p.product_type}</Badge>
                </div>
                <CardDescription>{p.short_pitch}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {Number(p.price_amount) > 0
                    ? `${p.currency} ${Number(p.price_amount).toLocaleString()}`
                    : 'Consultation / quote'}
                </p>
                {p.whatsapp_blurb && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {p.whatsapp_blurb}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">Active</span>
                  <Switch
                    checked={p.is_active}
                    onCheckedChange={() => void toggleActive(p)}
                  />
                </div>
                {Number(p.price_amount) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setPayProduct(p)}
                  >
                    Create Razorpay link
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!payProduct} onOpenChange={(o) => !o && setPayProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment link — {payProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Contact ID</Label>
              <Input
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                placeholder="UUID from Contacts / Leads"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Conversation ID (optional — sends WhatsApp)</Label>
              <Input
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
                placeholder="UUID from Inbox"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayProduct(null)}>
              Cancel
            </Button>
            <Button onClick={() => void sendPaymentLink()} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : 'Create link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
