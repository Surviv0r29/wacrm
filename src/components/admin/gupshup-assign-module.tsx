'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import type { AdminAccountRow } from '@/lib/admin/gupshup-accounts'
import { platformAdminFetch } from '@/lib/admin/platform-admin-client'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface AssignFormState {
  gupshupAppId: string
  apiKey: string
  phoneNumberId: string
  displayPhoneNumber: string
  gsAppId: string
}

const emptyForm = (): AssignFormState => ({
  gupshupAppId: '',
  apiKey: '',
  phoneNumberId: '',
  displayPhoneNumber: '',
  gsAppId: '',
})

function WhatsAppStatusBadge({ account }: { account: AdminAccountRow }) {
  const wa = account.whatsapp
  if (!wa) {
    return <Badge variant="outline">Not assigned</Badge>
  }
  if (wa.provider === 'gupshup') {
    return (
      <Badge
        variant={wa.status === 'connected' ? 'default' : 'secondary'}
        className="gap-1"
      >
        {wa.status === 'connected' ? (
          <CheckCircle2 className="size-3" />
        ) : (
          <XCircle className="size-3" />
        )}
        Gupshup · {wa.display_phone_number ?? '—'}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      {wa.provider} · {wa.display_phone_number ?? wa.phone_number_id ?? '—'}
    </Badge>
  )
}

export function GupshupAssignModule() {
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([])
  const [webhookUrl, setWebhookUrl] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<AdminAccountRow | null>(null)
  const [form, setForm] = useState<AssignFormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [hasExistingKey, setHasExistingKey] = useState(false)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await platformAdminFetch('/api/admin/accounts')
      if (res.status === 401) {
        toast.error('Session expired — unlock again')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data.error as string) ?? 'Failed to load accounts')
        return
      }
      const data = await res.json()
      setAccounts(data.accounts ?? [])
      setWebhookUrl(data.webhook_url ?? '')
    } catch {
      toast.error('Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  function openAssign(account: AdminAccountRow) {
    setSelected(account)
    const wa = account.whatsapp
    setForm({
      gupshupAppId: wa?.gupshup_app_id ?? '',
      apiKey: '',
      phoneNumberId: wa?.phone_number_id ?? '',
      displayPhoneNumber: wa?.display_phone_number ?? '',
      gsAppId: wa?.gs_app_id ?? '',
    })
    setHasExistingKey(Boolean(wa?.has_api_key))
    setDialogOpen(true)
  }

  function openNew() {
    setSelected(null)
    setForm(emptyForm())
    setHasExistingKey(false)
    setDialogOpen(true)
  }

  async function copyWebhook() {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success('Webhook URL copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  async function submitAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) {
      toast.error('Select an account from the table')
      return
    }

    const payload: Record<string, string> = {
      account_id: selected.id,
      gupshup_app_id: form.gupshupAppId.trim(),
      phone_number_id: form.phoneNumberId.trim(),
      display_phone_number: form.displayPhoneNumber.trim(),
    }
    if (form.gsAppId.trim()) payload.gs_app_id = form.gsAppId.trim()
    if (form.apiKey.trim()) payload.api_key = form.apiKey.trim()

    if (!payload.gupshup_app_id || !payload.phone_number_id || !payload.display_phone_number) {
      toast.error('Fill in all required fields')
      return
    }
    if (!hasExistingKey && !payload.api_key) {
      toast.error('API key is required for new assignments')
      return
    }

    setSaving(true)
    try {
      const res = await platformAdminFetch('/api/admin/whatsapp/assign', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((data.error as string) ?? 'Assignment failed')
        return
      }
      toast.success(data.updated ? 'Assignment updated' : 'Gupshup account assigned')
      setDialogOpen(false)
      await loadAccounts()
    } catch {
      toast.error('Assignment failed')
    } finally {
      setSaving(false)
    }
  }

  async function removeAssignment() {
    if (!selected?.whatsapp || selected.whatsapp.provider !== 'gupshup') return
    if (!confirm(`Remove Gupshup assignment for "${selected.name}"?`)) return

    setRemoving(true)
    try {
      const res = await platformAdminFetch(
        `/api/admin/whatsapp/assign?account_id=${encodeURIComponent(selected.id)}`,
        { method: 'DELETE' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((data.error as string) ?? 'Could not remove assignment')
        return
      }
      toast.success('Assignment removed')
      setDialogOpen(false)
      await loadAccounts()
    } catch {
      toast.error('Could not remove assignment')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gupshup assignments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign one Gupshup app and WhatsApp number per customer account.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAccounts()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={openNew} disabled={accounts.length === 0}>
            <Plus className="size-4" />
            Assign account
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Webhook URL</CardTitle>
          <CardDescription>
            Set this as the Gupshup V3 passthrough subscription callback for every
            assigned app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => void copyWebhook()}>
              <Copy className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Customer accounts</CardTitle>
          <CardDescription>
            {accounts.length} account{accounts.length === 1 ? '' : 's'} on this platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No accounts yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{account.id}</div>
                    </TableCell>
                    <TableCell>
                      <div>{account.owner.full_name}</div>
                      <div className="text-xs text-muted-foreground">{account.owner.email}</div>
                    </TableCell>
                    <TableCell>
                      <WhatsAppStatusBadge account={account} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openAssign(account)}
                      >
                        <Phone className="size-4" />
                        {account.whatsapp?.provider === 'gupshup' ? 'Edit' : 'Assign'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selected?.whatsapp?.provider === 'gupshup' ? 'Edit' : 'Assign'} Gupshup
            </DialogTitle>
            <DialogDescription>
              {selected ? (
                <>
                  <span className="font-medium text-foreground">{selected.name}</span>
                  {' · '}
                  {selected.owner.email}
                </>
              ) : (
                'Pick an account below, then enter Gupshup credentials from the partner dashboard.'
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitAssign} className="space-y-4">
            {!selected && (
              <div className="space-y-2">
                <Label htmlFor="assign-account">Account</Label>
                <select
                  id="assign-account"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value=""
                  onChange={(e) => {
                    const account = accounts.find((a) => a.id === e.target.value)
                    if (account) openAssign(account)
                  }}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.owner.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="gupshup-app-id">Gupshup app ID (Partner UUID) *</Label>
                <Input
                  id="gupshup-app-id"
                  value={form.gupshupAppId}
                  onChange={(e) => setForm((f) => ({ ...f, gupshupAppId: e.target.value }))}
                  placeholder="bf9ee64c-3d4d-4ac4-8668-732e577007c4"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Partner portal → Apps → copy the app UUID. Not the Meta phone_number_id.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="gs-app-id">gs_app_id (webhook routing)</Label>
                <Input
                  id="gs-app-id"
                  value={form.gsAppId}
                  onChange={(e) => setForm((f) => ({ ...f, gsAppId: e.target.value }))}
                  placeholder="Optional — from Gupshup webhook payload"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone-number-id">phone_number_id *</Label>
                <Input
                  id="phone-number-id"
                  value={form.phoneNumberId}
                  onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                  placeholder="Meta phone_number_id from passthrough"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display-phone">Display number *</Label>
                <Input
                  id="display-phone"
                  value={form.displayPhoneNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayPhoneNumber: e.target.value }))
                  }
                  placeholder="+918375031069"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="api-key">
                  API key {hasExistingKey ? '(leave blank to keep current)' : '*'}
                </Label>
                <Input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder={
                    hasExistingKey
                      ? '••••••••••••••••'
                      : 'App token (sk_…) or account apikey'
                  }
                  required={!hasExistingKey}
                />
                <p className="text-xs text-muted-foreground">
                  From Gupshup Partner → app → Get Access Token, or set{' '}
                  <code className="rounded bg-muted px-1">GUPSHUP_PARTNER_TOKEN</code> in
                  server env to fetch tokens automatically.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {selected?.whatsapp?.provider === 'gupshup' ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={saving || removing}
                  onClick={() => void removeAssignment()}
                >
                  {removing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !selected}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save assignment'
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
