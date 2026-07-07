import type { WhatsAppProvider } from '@/types'

/** Platform default from server env (also exposed to the client). */
export function defaultWhatsAppProvider(): WhatsAppProvider {
  const v = process.env.WHATSAPP_PROVIDER ?? process.env.NEXT_PUBLIC_WHATSAPP_PROVIDER
  return v === 'gupshup' ? 'gupshup' : 'meta'
}

export function isGupshupProvider(provider: string | null | undefined): boolean {
  return provider === 'gupshup'
}
