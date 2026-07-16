'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SettingsPanelHead } from './settings-panel-head'

const MASK = '••••••••••••••••'

export function RazorpaySettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [hasSecret, setHasSecret] = useState(false)
  const [hasWebhook, setHasWebhook] = useState(false)
  const [secretEdited, setSecretEdited] = useState(false)
  const [webhookEdited, setWebhookEdited] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/payments/config')
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to load Razorpay config')
        return
      }
      if (data.configured) {
        setKeyId(data.key_id ?? '')
        setIsActive(Boolean(data.is_active))
        setHasSecret(Boolean(data.has_key_secret))
        setHasWebhook(Boolean(data.has_webhook_secret))
        setKeySecret(data.has_key_secret ? MASK : '')
        setWebhookSecret(data.has_webhook_secret ? MASK : '')
      }
    } catch {
      toast.error('Failed to load Razorpay config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!keyId.trim()) {
      toast.error('Key ID is required')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        key_id: keyId.trim(),
        is_active: isActive,
      }
      if (secretEdited && keySecret && keySecret !== MASK) {
        body.key_secret = keySecret.trim()
      } else if (!hasSecret) {
        body.key_secret = keySecret.trim()
      }
      if (webhookEdited && webhookSecret && webhookSecret !== MASK) {
        body.webhook_secret = webhookSecret.trim()
      }

      const res = await fetch('/api/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to save')
        return
      }
      toast.success('Razorpay settings saved')
      setSecretEdited(false)
      setWebhookEdited(false)
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

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/payments/razorpay/webhook`
      : ''

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Razorpay"
        description="Closer agent uses Razorpay payment links for ebook and paid product checkout."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">API credentials</CardTitle>
          <CardDescription>
            Each advisor account uses their own Razorpay keys. Point webhooks to the URL below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Key ID</Label>
            <Input
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_…"
            />
          </div>
          <div className="space-y-2">
            <Label>Key secret</Label>
            <div className="flex gap-2">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={keySecret}
                onChange={(e) => {
                  setKeySecret(e.target.value)
                  setSecretEdited(true)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Webhook secret</Label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => {
                setWebhookSecret(e.target.value)
                setWebhookEdited(true)
              }}
              placeholder={hasWebhook ? 'Leave masked to keep' : 'Optional'}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Enable payments</p>
              <p className="text-xs text-muted-foreground">
                Allows creating payment links for products.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          {webhookUrl && (
            <div className="space-y-1">
              <Label>Webhook URL</Label>
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            </div>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save Razorpay'
            )}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
