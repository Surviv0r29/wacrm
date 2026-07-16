/**
 * Template slot keys every account gets. Customers map their
 * Gupshup/Meta-approved template names onto these slots.
 */

export interface TemplateSlotSeed {
  slot_key: string
  label: string
  description: string
  language: string
}

export const TEMPLATE_SLOT_SEEDS: TemplateSlotSeed[] = [
  {
    slot_key: 'welcome',
    label: 'Welcome',
    description: 'First outbound / re-open outside the 24h window.',
    language: 'en',
  },
  {
    slot_key: 'ebook_offer',
    label: 'Ebook offer',
    description: 'Promote or follow up on ebook / digital product.',
    language: 'en',
  },
  {
    slot_key: 'insurance_followup',
    label: 'Insurance follow-up',
    description: 'Nurture insurance prospects (utility/marketing approved).',
    language: 'en',
  },
  {
    slot_key: 'advisory_intro',
    label: 'Advisory intro',
    description: 'Introduce financial advising / RM conversation.',
    language: 'en',
  },
  {
    slot_key: 'payment_link',
    label: 'Payment link',
    description: 'Share Razorpay / payment CTA via template vars.',
    language: 'en',
  },
  {
    slot_key: 'booking_confirm',
    label: 'Booking confirm',
    description: 'Confirm RM call / meeting details.',
    language: 'en',
  },
]
