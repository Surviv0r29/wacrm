import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'ai_intent_router'
  | 'follow_up_reminder'
  | 'insurance_welcome'
  | 'insurance_intent_router'
  | 'insurance_follow_up'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  ai_intent_router: {
    slug: 'ai_intent_router',
    name: 'AI Intent Router',
    description:
      'Classify with Gemini Flash Lite, then reply with WhatsApp templates per intent. Pick your approved Pricing / Support templates before activating.',
    trigger_type: 'intent_match',
    trigger_config: {
      model: 'gemini-3.1-flash-lite',
      min_confidence: 0.6,
      intents: [
        {
          id: 'pricing',
          label: 'Pricing',
          description:
            'Asks about plans, cost, quotes, or buying — not a bare hi/hello',
          examples: [
            'How much does it cost?',
            'Send me a quote',
            'What are your plans?',
          ],
        },
        {
          id: 'support',
          label: 'Support',
          description:
            'Has a problem, complaint, or needs help with an existing order. Do NOT use for bare greetings like hi/hello.',
          examples: [
            'My order is delayed',
            'Something is broken',
            'I need help with my account',
          ],
        },
      ],
    },
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'detected_intent',
          value: 'pricing',
        },
      },
      {
        step_type: 'send_template',
        step_config: {
          template_slot: 'ebook_offer',
          template_name: '',
          language: 'en',
          variables: { '1': '{{ message.text }}' },
        },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'send_template',
        step_config: {
          template_slot: 'insurance_followup',
          template_name: '',
          language: 'en',
          variables: { '1': '{{ message.text }}' },
        },
        parent_index: 0,
        branch: 'no',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
  insurance_welcome: {
    slug: 'insurance_welcome',
    name: 'Insurance Advisor Welcome',
    description:
      'First inbound greeting for ebook / insurance / advisory prospects. Seeds a New Lead deal.',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Hi! 👋 Welcome. I help with insurance education ebooks, protection planning, and financial advisory conversations.\n\nReply with:\n1 — Ebook / learning\n2 — Insurance products\n3 — Talk to an advisor / RM\n\n_General information only; not personalized advice._",
        },
      },
    ],
  },
  insurance_intent_router: {
    slug: 'insurance_intent_router',
    name: 'Insurance Intent Router (Flash Lite)',
    description:
      'Gemini Flash Lite classifies ebook / insurance / advisory / buy / human — then tags + replies. Sales AI still handles open Q&A.',
    trigger_type: 'intent_match',
    trigger_config: {
      model: 'gemini-3.1-flash-lite',
      min_confidence: 0.6,
      intents: [
        {
          id: 'ebook',
          label: 'Ebook',
          description:
            'Wants an ebook, digital product, training guide, or learning material.',
          examples: [
            'Send me the ebook',
            'I want the insurance selling book',
            'Digital product price',
          ],
        },
        {
          id: 'insurance',
          label: 'Insurance',
          description:
            'Asks about insurance products, term, health cover, premiums, or protection.',
          examples: [
            'I need term insurance',
            'Health policy quote',
            'How much cover do I need?',
          ],
        },
        {
          id: 'advisory',
          label: 'Advisory',
          description:
            'Wants financial advice, wealth planning, or to speak with an RM / advisor.',
          examples: [
            'Book a call with RM',
            'Wealth planning',
            'Talk to a financial advisor',
          ],
        },
        {
          id: 'buy',
          label: 'Ready to buy',
          description:
            'Ready to pay, purchase, or complete checkout for an ebook or service.',
          examples: [
            'I want to buy',
            'Send payment link',
            'Razorpay link please',
          ],
        },
        {
          id: 'human',
          label: 'Human agent',
          description:
            'Explicitly asks for a human, agent, or relationship manager.',
          examples: [
            'Talk to a human',
            'Connect me to an agent',
            'I want to speak to RM',
          ],
        },
      ],
    },
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'detected_intent', value: 'ebook' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — our ebooks cover insurance selling, HNI acquisition, and advisor training. Tell me which topic you want, or ask for the catalog. Payment is via Razorpay when you're ready.",
        },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: { subject: 'detected_intent', value: 'insurance' },
        parent_index: 0,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Happy to help with insurance education and a consultation. Share your goal (term / health / review) and age band if you can.\n\n_This is general information only. Coverage and premiums are subject to underwriting._",
        },
        parent_index: 2,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: { subject: 'detected_intent', value: 'advisory' },
        parent_index: 2,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "I can arrange a discovery call with our advisor / RM. Share a preferred day/time window and we'll confirm.",
        },
        parent_index: 4,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: { subject: 'detected_intent', value: 'buy' },
        parent_index: 4,
        branch: 'no',
      },
      {
        step_type: 'create_payment_link',
        step_config: {
          send_message: true,
          template_slot: 'payment_link',
        },
        parent_index: 6,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 6,
        branch: 'no',
      },
    ],
  },
  insurance_follow_up: {
    slug: 'insurance_follow_up',
    name: 'Insurance Follow-up (24h)',
    description: 'Nudge if the prospect has not continued after an inbound.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just checking in — still interested in the ebook, insurance consult, or a call with our advisor? Happy to help whenever you're ready.",
        },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
