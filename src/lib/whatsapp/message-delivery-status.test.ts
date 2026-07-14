import { describe, expect, it } from 'vitest'
import {
  isValidMessageStatusTransition,
  normalizeMessageDeliveryStatus,
  webhookTimestampToIso,
} from './message-delivery-status'

describe('normalizeMessageDeliveryStatus', () => {
  it('maps Gupshup enqueued/submitted to sent', () => {
    expect(normalizeMessageDeliveryStatus('enqueued')).toBe('sent')
    expect(normalizeMessageDeliveryStatus('submitted')).toBe('sent')
  })

  it('passes through standard delivery states', () => {
    expect(normalizeMessageDeliveryStatus('delivered')).toBe('delivered')
    expect(normalizeMessageDeliveryStatus('read')).toBe('read')
    expect(normalizeMessageDeliveryStatus('failed')).toBe('failed')
  })

  it('returns null for unknown values', () => {
    expect(normalizeMessageDeliveryStatus('weird')).toBeNull()
  })
})

describe('isValidMessageStatusTransition', () => {
  it('only allows forward moves on the success ladder', () => {
    expect(isValidMessageStatusTransition('sent', 'delivered')).toBe(true)
    expect(isValidMessageStatusTransition('delivered', 'sent')).toBe(false)
  })

  it('allows failed only from sending or sent', () => {
    expect(isValidMessageStatusTransition('sent', 'failed')).toBe(true)
    expect(isValidMessageStatusTransition('delivered', 'failed')).toBe(false)
  })
})

describe('webhookTimestampToIso', () => {
  it('handles seconds and milliseconds', () => {
    expect(webhookTimestampToIso('1700000000')).toBe(
      new Date(1700000000 * 1000).toISOString(),
    )
    expect(webhookTimestampToIso('1700000000000')).toBe(
      new Date(1700000000000).toISOString(),
    )
  })
})
