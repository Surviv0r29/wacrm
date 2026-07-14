/** Allowed values on `messages.status` (001_initial_schema). */
export type MessageDeliveryStatus =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'

const MESSAGE_STATUS_LADDER = [
  'sending',
  'sent',
  'delivered',
  'read',
] as const

function messageLadderLevel(s: string): number {
  const idx = (MESSAGE_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Map provider webhook status strings onto `messages.status`.
 * Gupshup emits `enqueued` / `submitted` before Meta accepts the message.
 */
export function normalizeMessageDeliveryStatus(
  raw: string,
): MessageDeliveryStatus | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === 'enqueued' || s === 'submitted' || s === 'accepted') return 'sent'
  if (
    s === 'sending' ||
    s === 'sent' ||
    s === 'delivered' ||
    s === 'read' ||
    s === 'failed'
  ) {
    return s
  }
  return null
}

/** Forward-only along the success ladder; `failed` only from early states. */
export function isValidMessageStatusTransition(
  current: string,
  incoming: MessageDeliveryStatus,
): boolean {
  if (incoming === 'failed') {
    return current === 'sending' || current === 'sent'
  }
  if (current === 'failed') return false
  const ci = messageLadderLevel(current)
  const ii = messageLadderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

/** Webhook timestamps may be seconds or milliseconds since epoch. */
export function webhookTimestampToIso(timestamp: string): string {
  const n = parseInt(timestamp, 10)
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString()
  const ms = n > 1e12 ? n : n * 1000
  return new Date(ms).toISOString()
}
