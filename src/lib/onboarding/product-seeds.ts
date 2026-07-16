/**
 * Default product catalog seeded for every advisor account.
 */

export interface ProductSeed {
  name: string
  slug: string
  product_type: 'ebook' | 'insurance' | 'advisory' | 'other'
  description: string
  short_pitch: string
  price_amount: number
  currency: string
  whatsapp_blurb: string
  faq_bullets: string
  sort_order: number
}

export const PLATFORM_PRODUCT_SEEDS: ProductSeed[] = [
  {
    name: 'Insurance Selling Mastery Ebook',
    slug: 'insurance-selling-mastery',
    product_type: 'ebook',
    description:
      'Practical playbook for insurance agents: prospecting, objection handling, and follow-up systems.',
    short_pitch: 'Learn to prospect and close insurance conversations with confidence.',
    price_amount: 499,
    currency: 'INR',
    whatsapp_blurb:
      '📘 *Insurance Selling Mastery* — digital ebook. Pay securely via Razorpay and get instant access.',
    faq_bullets:
      'Digital download\nObjection scripts included\nNot personalized advice',
    sort_order: 1,
  },
  {
    name: 'HNI Client Acquisition Ebook',
    slug: 'hni-client-acquisition',
    product_type: 'ebook',
    description:
      'Frameworks for approaching high-net-worth and premium clients as a wealth / insurance advisor.',
    short_pitch: 'Win trust with premium and HNI prospects.',
    price_amount: 799,
    currency: 'INR',
    whatsapp_blurb:
      '📘 *HNI Client Acquisition* — for advisors targeting premium clients. Razorpay checkout available.',
    faq_bullets: 'HNI outreach scripts\nRelationship-first selling\nEducational only',
    sort_order: 2,
  },
  {
    name: 'Term Life Consultation',
    slug: 'term-life-consultation',
    product_type: 'insurance',
    description:
      'Discovery call for term life protection needs. Quote subject to underwriting.',
    short_pitch: 'Protect your family’s income with a guided term-life consult.',
    price_amount: 0,
    currency: 'INR',
    whatsapp_blurb:
      '🛡️ *Term Life Consultation* — book a call with our advisor. Premiums depend on age and underwriting.',
    faq_bullets:
      'General information only\nLicensed advisor completes quote\nNo premium promised in chat',
    sort_order: 3,
  },
  {
    name: 'Health Insurance Review',
    slug: 'health-insurance-review',
    product_type: 'insurance',
    description:
      'Review existing cover and discuss health insurance options with an advisor.',
    short_pitch: 'Check gaps in your health cover with a specialist.',
    price_amount: 0,
    currency: 'INR',
    whatsapp_blurb:
      '🏥 *Health Insurance Review* — talk to an advisor about cover gaps. Not a binding quote.',
    faq_bullets: 'Educational review\nUnderwriting applies\nHuman advisor required',
    sort_order: 4,
  },
  {
    name: 'Wealth Planning Discovery Call',
    slug: 'wealth-planning-call',
    product_type: 'advisory',
    description:
      '30-minute discovery with a financial advisor / RM for goals and next steps.',
    short_pitch: 'Clarify goals with a Relationship Manager.',
    price_amount: 0,
    currency: 'INR',
    whatsapp_blurb:
      '💼 *Wealth Planning Discovery Call* — we will confirm a slot with our RM.',
    faq_bullets: 'Not investment advice in chat\nHuman RM books the call\nHNI welcome',
    sort_order: 5,
  },
]
