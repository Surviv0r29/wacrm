'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const STAGES = [
  'new',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'nurture',
] as const

interface LeadRow {
  id: string
  stage: string
  interest: string | null
  source: string
  score: number
  conversation_id: string | null
  updated_at: string
  contacts: { id: string; name: string | null; phone: string; email: string | null } | null
  products: { id: string; name: string; product_type: string } | null
}

export default function LeadsPage() {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [stageFilter, setStageFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q =
        stageFilter === 'all'
          ? '/api/leads'
          : `/api/leads?stage=${encodeURIComponent(stageFilter)}`
      const res = await fetch(q)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to load leads')
        return
      }
      setLeads(data.leads ?? [])
    } catch {
      toast.error('Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [stageFilter])

  useEffect(() => {
    void load()
  }, [load])

  const updateStage = async (id: string, stage: string) => {
    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, stage }),
    })
    if (!res.ok) {
      toast.error('Failed to update lead')
      return
    }
    toast.success('Lead updated')
    void load()
  }

  const sendPaymentForLead = async (lead: LeadRow) => {
    const contactId = lead.contacts?.id
    if (!contactId) {
      toast.error('Lead has no contact')
      return
    }
    const res = await fetch('/api/payments/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contactId,
        product_id: lead.products?.id,
        conversation_id: lead.conversation_id || undefined,
        send_whatsapp: Boolean(lead.conversation_id),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || 'Failed to create payment link')
      return
    }
    toast.success(data.payment_link?.short_url || 'Payment link created')
    void load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            WhatsApp prospects moving through ebook, insurance, and advisory conversion.
          </p>
        </div>
        <Select
          value={stageFilter}
          onValueChange={(v) => {
            if (v) setStageFilter(v)
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Users className="size-8 opacity-50" />
            <p>No leads yet. Inbound WhatsApp + Lead Capture will create them.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Interest</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Source</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {lead.contacts?.name || lead.contacts?.phone || 'Unknown'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lead.contacts?.email || lead.contacts?.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{lead.interest || 'unknown'}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lead.products?.name || '—'}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={lead.stage}
                      onValueChange={(v) => {
                        if (v) void updateStage(lead.id, v)
                      }}
                    >
                      <SelectTrigger className="w-[140px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lead.source}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void sendPaymentForLead(lead)}
                    >
                      Pay link
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
