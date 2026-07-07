'use client'

import { GupshupAssignModule } from '@/components/admin/gupshup-assign-module'
import { PlatformAdminGate } from '@/components/admin/platform-admin-gate'

const PLATFORM_GUPSHUP =
  process.env.NEXT_PUBLIC_WHATSAPP_PROVIDER === 'gupshup'

export default function GupshupAdminPage() {
  if (!PLATFORM_GUPSHUP) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold">Gupshup admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This module is only available when{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            NEXT_PUBLIC_WHATSAPP_PROVIDER=gupshup
          </code>{' '}
          is set.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8">
      <PlatformAdminGate>
        <GupshupAssignModule />
      </PlatformAdminGate>
    </div>
  )
}
