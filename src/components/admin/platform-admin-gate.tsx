'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  clearPlatformAdminSecret,
  getPlatformAdminSecret,
  platformAdminFetch,
  setPlatformAdminSecret,
} from '@/lib/admin/platform-admin-client'

export function PlatformAdminGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [secret, setSecret] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const stored = getPlatformAdminSecret()
    if (stored) {
      setAuthenticated(true)
    }
    setReady(true)
  }, [])

  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = secret.trim()
    if (!trimmed) {
      toast.error('Enter the platform admin secret')
      return
    }

    setChecking(true)
    try {
      const res = await platformAdminFetch('/api/admin/accounts', {}, trimmed)
      if (res.status === 401) {
        toast.error('Invalid platform admin secret')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data.error as string) ?? 'Could not verify secret')
        return
      }
      setPlatformAdminSecret(trimmed)
      setAuthenticated(true)
      toast.success('Platform admin access granted')
    } catch {
      toast.error('Could not verify secret')
    } finally {
      setChecking(false)
    }
  }

  function signOut() {
    clearPlatformAdminSecret()
    setAuthenticated(false)
    setSecret('')
  }

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <CardTitle>Platform admin</CardTitle>
          <CardDescription>
            Enter the platform operator secret to manage Gupshup account
            assignments. Stored in this browser session only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={unlock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="platform-admin-secret">Admin secret</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="platform-admin-secret"
                  type="password"
                  autoComplete="off"
                  className="pl-9"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="PLATFORM_ADMIN_SECRET"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={checking}>
              {checking ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                'Unlock'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={signOut}>
          Lock admin panel
        </Button>
      </div>
      {children}
    </div>
  )
}
