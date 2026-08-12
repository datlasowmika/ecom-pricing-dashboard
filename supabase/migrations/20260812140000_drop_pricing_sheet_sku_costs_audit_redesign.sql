-- Discontinue legacy flat pricing_sheet; add fixed SKU cost reference; rebuild audit for normalized model.

-- ---------------------------------------------------------------------------
-- 1. Drop legacy pricing_sheet (flat UUID table) and its triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_calculate_pricing_metrics ON public.pricing_sheet;
DROP TRIGGER IF EXISTS trg_recompute_demand_pct_insert ON public.pricing_sheet;
DROP TRIGGER IF EXISTS trg_recompute_demand_pct_update ON public.pricing_sheet;
DROP TABLE IF EXISTS public.pricing_sheet CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Fixed cost components per FSN + weight unit (feed / upsert separately)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fsn_cost_components (
  fsn_id TEXT NOT NULL,
  weight_unit TEXT NOT NULL,
  pm_cost NUMERIC(12, 2) NULL,
  fml_dump NUMERIC(12, 2) NULL,
  pc NUMERIC(12, 2) NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),

  CONSTRAINT fsn_cost_components_pkey PRIMARY KEY (fsn_id, weight_unit)
);

CREATE INDEX IF NOT EXISTS fsn_cost_components_fsn_idx
  ON public.fsn_cost_components (fsn_id);

ALTER TABLE public.fsn_cost_components ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fsn_cost_components' AND policyname = 'fsn_cost_components_anon_all'
  ) THEN
    CREATE POLICY fsn_cost_components_anon_all ON public.fsn_cost_components
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fsn_cost_components TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Align price_sheet_details PK column name (id → price_sheet_details_id)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_sheet_details' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_sheet_details' AND column_name = 'price_sheet_details_id'
  ) THEN
    ALTER TABLE public.price_sheet_details RENAME COLUMN id TO price_sheet_details_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Metrics trigger: fixed costs from fsn_cost_components (not prior sheets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_price_sheet_detail_metrics()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  hdr_delivery_date date;
  hdr_city text;
  prev_nlc numeric(12,2);
  grn_delta numeric(12,2) := 0;
  ref_pm_cost numeric(12,2);
  ref_fml_dump numeric(12,2);
  ref_pc numeric(12,2);
  prev_quoted_pp numeric(12,2);
begin
  select ps.delivery_date, ps.city
  into hdr_delivery_date, hdr_city
  from public.price_sheet ps
  where ps.price_sheet_id = new.price_sheet_id;

  new.updated_at := now();

  if TG_OP = 'INSERT' then
    select scc.pm_cost, scc.fml_dump, scc.pc
    into ref_pm_cost, ref_fml_dump, ref_pc
    from public.fsn_cost_components scc
    where scc.fsn_id = new.fsn_id
      and scc.weight_unit = new.weight_unit;

    if new.pm_cost is null then new.pm_cost := coalesce(ref_pm_cost, 0); end if;
    if new.fml_dump is null then new.fml_dump := coalesce(ref_fml_dump, 0); end if;
    if new.pc is null then new.pc := coalesce(ref_pc, 0); end if;

    select d.quoted_pp
    into prev_quoted_pp
    from public.price_sheet_details d
    join public.price_sheet ps on ps.price_sheet_id = d.price_sheet_id
    where d.fsn_id = new.fsn_id
      and d.weight_unit = new.weight_unit
      and ps.city = hdr_city
      and ps.delivery_date < hdr_delivery_date
    order by ps.delivery_date desc
    limit 1;

    if new.quoted_pp is null then new.quoted_pp := prev_quoted_pp; end if;
  end if;

  new.grn_price_per_kg := coalesce(new.grn_price_per_kg, new.prev_grn_price_per_kg, new.t3_grn_price_per_kg);
  new.grn_price_per_unit := coalesce(new.grn_price_per_unit, new.prev_grn_price_per_unit, new.t3_grn_price_per_unit);

  if TG_OP = 'UPDATE' then
    grn_delta := coalesce(new.adjusted_grn, 0) - coalesce(old.adjusted_grn, 0);
  elsif TG_OP = 'INSERT' then
    grn_delta := coalesce(new.adjusted_grn, 0);
  end if;
  if grn_delta <> 0 then
    if TG_OP = 'UPDATE' or new.quoted_pp is null then
      new.quoted_pp := coalesce(new.quoted_pp, 0) + grn_delta;
    end if;
  end if;

  new.nlc := coalesce(new.quoted_pp, 0) + coalesce(new.pm_cost, 0) + coalesce(new.fml_dump, 0) + coalesce(new.pc, 0);

  if new.blinkit_sp is not null and new.blinkit_sp <> 0 then
    new.pi_pct := round(((new.blinkit_sp - new.nlc) / new.blinkit_sp) * 100, 2);
  else
    new.pi_pct := null;
  end if;

  if new.grn_price_per_unit is not null then
    new.gm := new.nlc - new.grn_price_per_unit;
  else
    new.gm := null;
  end if;

  if new.grn_price_per_unit is not null and new.prev_grn_price_per_unit is not null then
    new.grn_diff := new.grn_price_per_unit - new.prev_grn_price_per_unit;
  else
    new.grn_diff := null;
  end if;

  select d.nlc into prev_nlc
  from public.price_sheet_details d
  join public.price_sheet ps on ps.price_sheet_id = d.price_sheet_id
  where d.fsn_id = new.fsn_id
    and d.weight_unit = new.weight_unit
    and ps.city = hdr_city
    and ps.delivery_date < hdr_delivery_date
  order by ps.delivery_date desc
  limit 1;

  if prev_nlc is not null and prev_nlc <> 0 then
    new.deflection_pct := round(((new.nlc - prev_nlc) / prev_nlc) * 100, 2);
  else
    new.deflection_pct := null;
  end if;

  if new.grn_price_per_unit is not null and new.demand_pct is not null then
    new.impact_pp_diff := round((coalesce(new.quoted_pp,0) - new.grn_price_per_unit) * new.demand_pct, 2);
  else
    new.impact_pp_diff := null;
  end if;

  if new.gm is not null and new.demand_pct is not null then
    new.impact_gm := round(new.gm * new.demand_pct, 2);
  else
    new.impact_gm := null;
  end if;

  if new.blinkit_sp is not null and new.demand_units is not null then
    new.bk_value_mix := round(new.blinkit_sp * new.demand_units, 2);
  else
    new.bk_value_mix := null;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Rebuild pricing_sheet_audit — revision_id PK, FK to detail + sheet
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.pricing_sheet_audit;

CREATE TABLE public.pricing_sheet_audit (
  revision_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revision_type SMALLINT NOT NULL DEFAULT 0 CHECK (revision_type IN (0, 1)),

  price_sheet_details_id UUID NOT NULL
    REFERENCES public.price_sheet_details (price_sheet_details_id) ON DELETE CASCADE,
  price_sheet_id UUID NOT NULL
    REFERENCES public.price_sheet (price_sheet_id) ON DELETE CASCADE,

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

  CONSTRAINT pricing_sheet_audit_pkey PRIMARY KEY (revision_id)
);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_details_revision_idx
  ON public.pricing_sheet_audit (price_sheet_details_id, revision_type, created_at DESC);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_sheet_idx
  ON public.pricing_sheet_audit (price_sheet_id);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_row_created_idx
  ON public.pricing_sheet_audit (city, delivery_date, fsn_id, weight_unit, created_at DESC);

ALTER TABLE public.pricing_sheet_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pricing_sheet_audit' AND policyname = 'pricing_sheet_audit_anon_all'
  ) THEN
    CREATE POLICY pricing_sheet_audit_anon_all ON public.pricing_sheet_audit
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_sheet_audit TO anon, authenticated;
