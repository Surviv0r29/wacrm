'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SettingsPanelHead } from './settings-panel-head'

interface SlotRow {
  id: string
  slot_key: string
  label: string
  description: string | null
  template_name: string | null
  language: string
}

export function TemplateSlotsSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [slots, setSlots] = useState<SlotRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/template-slots')
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to load template slots')
        return
      }
      setSlots(data.slots ?? [])
    } catch {
      toast.error('Failed to load template slots')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateLocal = (id: string, patch: Partial<SlotRow>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/template-slots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: slots.map((s) => ({
            id: s.id,
            template_name: s.template_name?.trim() || null,
            language: s.language || 'en',
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to save')
        return
      }
      toast.success('Template slots saved')
      void load()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Template slots"
        description="Map your Gupshup-approved WhatsApp templates to agent / automation slots. Leave blank until templates are approved."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Slot mapping</CardTitle>
          <CardDescription>
            Agents and automations reference these keys — not raw template names.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No slots yet. Open the dashboard once to seed the onboarding pack.
            </p>
          ) : (
            slots.map((slot) => (
              <div key={slot.id} className="grid gap-3 border-b border-border pb-4 last:border-0">
                <div>
                  <p className="font-medium text-foreground">{slot.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {slot.slot_key}
                    {slot.description ? ` — ${slot.description}` : ''}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Template name</Label>
                    <Input
                      value={slot.template_name ?? ''}
                      onChange={(e) =>
                        updateLocal(slot.id, { template_name: e.target.value })
                      }
                      placeholder="approved_template_name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Input
                      value={slot.language}
                      onChange={(e) =>
                        updateLocal(slot.id, { language: e.target.value })
                      }
                      placeholder="en"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
          <Button onClick={handleSave} disabled={saving || slots.length === 0}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save mappings'
            )}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
