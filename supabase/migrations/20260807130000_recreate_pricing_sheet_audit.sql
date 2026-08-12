-- Recreate pricing_sheet_audit to mirror pricing_sheet + revision_id + revision_type only.
-- revision_type: 0 = current lock, 1 = previous/historical (last three changes).
-- Sparse writes: only changed value columns are populated; unchanged stay null.
-- No changed_columns / pricing_sheet_id metadata columns.

DROP TABLE IF EXISTS public.pricing_sheet_audit;

CREATE TABLE public.pricing_sheet_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revision_type SMALLINT NOT NULL DEFAULT 0 CHECK (revision_type IN (0, 1)),

  delivery_date DATE NULL,
  city TEXT NULL,
  city_id INTEGER NULL,
  fsn_id TEXT NULL,
  weight_unit TEXT NULL,
  sku_id TEXT NULL,
  sku_name TEXT NULL,
  cf NUMERIC(12, 2) NULL,
  bucket TEXT NULL,
  subcategory TEXT NULL,
  demand_units NUMERIC(12, 2) NULL,
  demand_pct NUMERIC(12, 3) NULL,
  grn_price_per_kg NUMERIC(12, 2) NULL,
  grn_price_per_unit NUMERIC(12, 2) NULL,
  prev_grn_price_per_kg NUMERIC(12, 2) NULL,
  prev_grn_price_per_unit NUMERIC(12, 2) NULL,
  grn_diff NUMERIC NULL,
  blinkit_sp NUMERIC(12, 2) NULL,
  adjusted_grn NUMERIC(12, 2) NULL,
  quoted_pp NUMERIC(12, 2) NULL,
  negotiated_pp NUMERIC(12, 2) NULL,
  submitted BOOLEAN NULL,
  pm_cost NUMERIC(12, 2) NULL,
  fml_dump NUMERIC(12, 2) NULL,
  pc NUMERIC(12, 2) NULL,
  nlc NUMERIC(12, 2) NULL,
  pi_pct NUMERIC(12, 2) NULL,
  gm NUMERIC(12, 2) NULL,
  deflection_pct NUMERIC(12, 2) NULL,
  impact_pp_diff NUMERIC(12, 2) NULL,
  impact_gm NUMERIC(12, 2) NULL,
  bk_value_mix NUMERIC(12, 2) NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  nlc_negotiated NUMERIC(12, 2) NULL,
  pi_pct_quoted NUMERIC(12, 2) NULL,
  pi_pct_negotiated NUMERIC(12, 2) NULL,
  quoted_locked BOOLEAN NULL,
  negotiated_locked BOOLEAN NULL,
  adjusted_grn_locked BOOLEAN NULL,
  blinkit_sp_locked BOOLEAN NULL,
  grn_locked BOOLEAN NULL,
  t3_grn_price_per_kg NUMERIC(12, 2) NULL,
  t3_grn_price_per_unit NUMERIC(12, 2) NULL,

  CONSTRAINT pricing_sheet_audit_pkey PRIMARY KEY (id),
  CONSTRAINT pricing_sheet_audit_revision_id_key UNIQUE (revision_id)
);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_row_created_idx
  ON public.pricing_sheet_audit (city, delivery_date, fsn_id, weight_unit, created_at DESC);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_row_revision_idx
  ON public.pricing_sheet_audit (city, delivery_date, fsn_id, weight_unit, revision_type);

ALTER TABLE public.pricing_sheet_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pricing_sheet_audit'
      AND policyname = 'pricing_sheet_audit_anon_all'
  ) THEN
    CREATE POLICY pricing_sheet_audit_anon_all
      ON public.pricing_sheet_audit
      FOR ALL
      TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_sheet_audit TO anon, authenticated;
