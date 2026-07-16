-- ============================================================
-- 034_insurance_crm_onboarding.sql
-- Products, leads, template slots, Razorpay config, onboarding flag.
-- Idempotent — safe to re-run.
-- ============================================================

-- Track whether the insurance/advisor onboarding pack was seeded.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_seeded_at timestamptz;

-- ------------------------------------------------------------
-- Products & services (ebook / insurance / advisory)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  product_type text NOT NULL
    CHECK (product_type IN ('ebook', 'insurance', 'advisory', 'other')),
  description text,
  short_pitch text,
  price_amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  whatsapp_blurb text,
  faq_bullets text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_products_account
  ON products (account_id)
  WHERE is_active = true;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products
  FOR INSERT WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products
  FOR UPDATE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products
  FOR DELETE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

-- ------------------------------------------------------------
-- Leads (lifecycle on top of contacts)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'new'
    CHECK (stage IN (
      'new', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'nurture'
    )),
  interest text
    CHECK (
      interest IS NULL
      OR interest IN ('ebook', 'insurance', 'advisory', 'unknown')
    ),
  source text NOT NULL DEFAULT 'whatsapp',
  score integer NOT NULL DEFAULT 0,
  notes text,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_touch_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_account_stage
  ON leads (account_id, stage);

CREATE INDEX IF NOT EXISTS idx_leads_contact
  ON leads (contact_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select ON leads;
CREATE POLICY leads_select ON leads
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS leads_insert ON leads;
CREATE POLICY leads_insert ON leads
  FOR INSERT WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin', 'agent')
  );

DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads
  FOR UPDATE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin', 'agent')
  );

DROP POLICY IF EXISTS leads_delete ON leads;
CREATE POLICY leads_delete ON leads
  FOR DELETE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

-- Optional product link on deals
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- WhatsApp template slots (map Meta/Gupshup templates → agent steps)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  label text NOT NULL,
  description text,
  template_name text,
  language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, slot_key)
);

CREATE INDEX IF NOT EXISTS idx_template_slots_account
  ON template_slots (account_id);

ALTER TABLE template_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_slots_select ON template_slots;
CREATE POLICY template_slots_select ON template_slots
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS template_slots_write ON template_slots;
CREATE POLICY template_slots_write ON template_slots
  FOR ALL USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  )
  WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

-- ------------------------------------------------------------
-- Razorpay (per-account)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay'
    CHECK (provider IN ('razorpay')),
  key_id text,
  key_secret text,
  webhook_secret text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_configs_select ON payment_configs;
CREATE POLICY payment_configs_select ON payment_configs
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS payment_configs_write ON payment_configs;
CREATE POLICY payment_configs_write ON payment_configs
  FOR ALL USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  )
  WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin')
  );

CREATE TABLE IF NOT EXISTS payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  razorpay_payment_link_id text,
  short_url text,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_account
  ON payment_links (account_id);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_links_select ON payment_links;
CREATE POLICY payment_links_select ON payment_links
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS payment_links_write ON payment_links;
CREATE POLICY payment_links_write ON payment_links
  FOR ALL USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin', 'agent')
  )
  WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid())
      IN ('owner', 'admin', 'agent')
  );
