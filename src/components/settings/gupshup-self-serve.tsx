'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
} from 'lucide-react'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SettingsPanelHead } from './settings-panel-head'
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types'

const MASKED = '••••••••••••••••'

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown'

interface Props {
  config: WhatsAppConfigType | null
  connectionStatus: ConnectionStatus
  statusMessage: string
  onSaved: () => void
}

/**
 * Self-serve Gupshup credentials form. Admin assign at /admin/gupshup
 * remains available for platform operators.
 */
export function GupshupSelfServePanel({
  config,
  connectionStatus,
  statusMessage,
  onSaved,
}: Props) {
  const [gupshupAppId, setGupshupAppId] = useState('')
  const [gupshupAppName, setGupshupAppName] = useState('')
  const [gsAppId, setGsAppId] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [displayPhone, setDisplayPhone] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyEdited, setKeyEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    setGupshupAppId(config?.gupshup_app_id ?? '')
    setGupshupAppName(config?.gupshup_app_name ?? '')
    setGsAppId(config?.gs_app_id ?? '')
    setPhoneNumberId(config?.phone_number_id ?? '')
    setDisplayPhone(config?.display_phone_number ?? '')
    setApiKey(config ? MASKED : '')
    setKeyEdited(false)
  }, [config])

  useEffect(() => {
    void fetch('/api/whatsapp/gupshup')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.webhook_url === 'string') setWebhookUrl(d.webhook_url)
      })
      .catch(() => undefined)
  }, [])

  const handleSave = async () => {
    if (!gupshupAppId.trim() || !phoneNumberId.trim() || !displayPhone.trim()) {
      toast.error('App ID, phone number ID, and display phone are required')
      return
    }
    if (!config && !apiKey.trim()) {
      toast.error('API key is required for the first connection')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, string> = {
        gupshup_app_id: gupshupAppId.trim(),
        phone_number_id: phoneNumberId.trim(),
        display_phone_number: displayPhone.trim(),
      }
      if (gupshupAppName.trim()) payload.gupshup_app_name = gupshupAppName.trim()
      if (gsAppId.trim()) payload.gs_app_id = gsAppId.trim()
      if (keyEdited && apiKey && apiKey !== MASKED) {
        payload.api_key = apiKey.trim()
      } else if (!config) {
        payload.api_key = apiKey.trim()
      }

      const res = await fetch('/api/whatsapp/gupshup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to save Gupshup config')
        return
      }
      toast.success(
        data.updated ? 'Gupshup connection updated' : 'Gupshup connected',
      )
      if (data.webhook_url) setWebhookUrl(data.webhook_url)
      onSaved()
    } catch {
      toast.error('Failed to save Gupshup config')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm('Disconnect Gupshup from this account?')) return
    setRemoving(true)
    try {
      const res = await fetch('/api/whatsapp/gupshup', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to disconnect')
        return
      }
      toast.success('Gupshup disconnected')
      onSaved()
    } catch {
      toast.error('Failed to disconnect')
    } finally {
      setRemoving(false)
    }
  }

  const copyWebhook = async () => {
    if (!webhookUrl) return
    await navigator.clipboard.writeText(webhookUrl)
    toast.success('Webhook URL copied')
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp connection (Gupshup)"
        description="Connect your own Gupshup WhatsApp app. Platform admins can still assign numbers from Gupshup Admin."
      />

      <Alert className="mb-6 bg-card border-border">
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          <AlertTitle className="text-foreground mb-0">
            {connectionStatus === 'connected' ? 'Connected' : 'Not connected'}
          </AlertTitle>
        </div>
        <AlertDescription className="text-muted-foreground">
          {connectionStatus === 'connected'
            ? 'Your Gupshup credentials are saved. Point your Gupshup app webhook at the URL below.'
            : statusMessage ||
              'Paste your Gupshup App ID, API key, and phone details to start messaging.'}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Gupshup credentials</CardTitle>
          <CardDescription>
            Use Partner V3 or Self-Serve credentials from your Gupshup console.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gs-app-id">Gupshup App ID</Label>
            <Input
              id="gs-app-id"
              value={gupshupAppId}
              onChange={(e) => setGupshupAppId(e.target.value)}
              placeholder="Your Gupshup app UUID"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gs-app-name">App name (Self-Serve, optional)</Label>
            <Input
              id="gs-app-name"
              value={gupshupAppName}
              onChange={(e) => setGupshupAppName(e.target.value)}
              placeholder="src.name for Self-Serve API"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gs-passthrough">gs_app_id override (optional)</Label>
            <Input
              id="gs-passthrough"
              value={gsAppId}
              onChange={(e) => setGsAppId(e.target.value)}
              placeholder="Defaults to App ID if empty"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gs-phone-id">Phone number ID</Label>
            <Input
              id="gs-phone-id"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="WhatsApp phone number id"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gs-display">Display phone number</Label>
            <Input
              id="gs-display"
              value={displayPhone}
              onChange={(e) => setDisplayPhone(e.target.value)}
              placeholder="+91…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gs-key">API key</Label>
            <div className="flex gap-2">
              <Input
                id="gs-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setKeyEdited(true)
                }}
                placeholder="Gupshup API token"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {config && (
              <p className="text-xs text-muted-foreground">
                Leave masked to keep the existing key. Edit to rotate.
              </p>
            )}
          </div>

          {webhookUrl && (
            <div className="space-y-2">
              <Label>Webhook URL (set in Gupshup)</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copyWebhook}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Gupshup connection'
              )}
            </Button>
            {config && (
              <Button
                variant="outline"
                onClick={handleRemove}
                disabled={removing}
                className="text-red-400"
              >
                {removing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Disconnect'
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
