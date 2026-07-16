/**
 * Shared knowledge-base pack — same Q&A structure for every customer account.
 * Seeded on onboarding; customers do not train the bot from scratch.
 */

export interface KnowledgeDocSeed {
  title: string
  content: string
}

export const PLATFORM_KNOWLEDGE_PACK: KnowledgeDocSeed[] = [
  {
    title: 'Insurance & compliance FAQ',
    content: `Q: Are you giving personalized insurance advice on WhatsApp?
A: No. Replies are general information only. Coverage, premiums, and eligibility depend on underwriting and product terms. Always consult a licensed advisor before buying.

Q: What insurance topics do you cover?
A: Life protection, health insurance basics, term plans overview, and how to prepare for a consultation with an advisor. Exact products available depend on the advisor's catalog.

Q: Can you tell me my exact premium?
A: Exact premiums need age, health, sum assured, and underwriting. Share your details and we will connect you with a licensed advisor for a quote.

Q: What if I already have a policy?
A: We can help you understand gaps and education materials. We do not cancel or replace policies in chat — an advisor reviews that with you.

Q: Claims help?
A: For claim filing, documents, and status, we hand you to a human advisor. Do not share sensitive medical documents in open chat unless asked by your advisor.`,
  },
  {
    title: 'Ebook & digital products FAQ',
    content: `Q: What ebooks / digital products do you sell?
A: Educational guides on insurance basics, prospecting for advisors, objection handling, and wealth planning primers. See the product catalog for current titles and prices.

Q: How do I buy an ebook?
A: Tell us which title you want. We share a secure Razorpay payment link. After payment you receive download / access instructions.

Q: Refunds?
A: Digital product refunds follow the advisor's stated policy (typically within a short window if the file was not downloaded). Ask for the refund policy if unsure.

Q: Is the ebook personalized advice?
A: No. Ebooks are educational. They do not replace a licensed advisor or a personalized financial plan.`,
  },
  {
    title: 'Financial advising & RM FAQ',
    content: `Q: What does financial advising / RM support include?
A: Goal discovery, protection vs investment education, portfolio conversation prep, and scheduled calls with a Relationship Manager / advisor.

Q: How do I book a call?
A: Say "book a call" or "talk to RM". We capture your preference and a human advisor confirms the slot.

Q: HNI / premium clients?
A: High-net-worth and premium clients get priority human follow-up. Mention if you prefer a senior advisor.

Q: Bank / existing relationship?
A: We can coordinate with your existing bank RM process if applicable — ask to speak with a human.`,
  },
  {
    title: 'Objection handling scripts',
    content: `Objection: "Too expensive"
Reply: Acknowledge budget. Offer a smaller ebook starter or a free discovery call to see fit — never invent discounts.

Objection: "I need to think"
Reply: Respect the pause. Offer one useful FAQ answer and ask if a 10-minute call would help. Follow up later without pressure.

Objection: "I already have insurance"
Reply: Great — education can still help review gaps. Offer ebook or a review call with an advisor.

Objection: "Send me everything on WhatsApp"
Reply: Summarize 3 bullets from the knowledge base, then offer the detailed ebook or a call. Do not paste long policy wordings.

Objection: "Is this AI?"
Reply: Yes, an assistant helping the advisor's team. Offer to connect to a human anytime.`,
  },
]
