import { createClient } from "@supabase/supabase-js";

// External Supabase project (BYO). Publishable key is safe on the client.
const SUPABASE_URL = "https://ienxcmcnevffdisehxnh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_7MQUBROngx7GmPB6thoiIA_MkjEWEnw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type PriceSheetStatus = "Created" | "Submitted for Approval" | "Approved";

/** Header row: one per delivery_date + city. */
export type PriceSheetHeader = {
  price_sheet_id: string;
  delivery_date: string;
  city: string;
  city_id: number | null;
  status: PriceSheetStatus;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Line-item row: SKU-level fields (no delivery_date / city). */
export type PriceSheetDetailRow = {
  price_sheet_details_id?: string;
  /** @deprecated alias — use price_sheet_details_id */
  id?: string;
  price_sheet_id: string;
  fsn_id: string | null;
  weight_unit: string | null;
  sku_id: string | null;
  sku_name: string | null;
  cf: number | null;
  bucket: string | null;
  subcategory: string | null;
  demand_units: number | null;
  demand_pct: number | null;
  grn_price_per_kg: number | null;
  grn_price_per_unit: number | null;
  prev_grn_price_per_kg: number | null;
  prev_grn_price_per_unit: number | null;
  t3_grn_price_per_kg: number | null;
  t3_grn_price_per_unit: number | null;
  grn_diff: number | null;
  blinkit_sp: number | null;
  adjusted_grn: number | null;
  quoted_pp: number | null;
  negotiated_pp: number | null;
  submitted: boolean | null;
  pm_cost: number | null;
  fml_dump: number | null;
  pc: number | null;
  nlc: number | null;
  pi_pct: number | null;
  gm: number | null;
  deflection_pct: number | null;
  impact_pp_diff: number | null;
  impact_gm: number | null;
  bk_value_mix: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  nlc_negotiated?: number | null;
  pi_pct_quoted?: number | null;
  pi_pct_negotiated?: number | null;
  quoted_locked: boolean | null;
  negotiated_locked: boolean | null;
  adjusted_grn_locked: boolean | null;
  blinkit_sp_locked: boolean | null;
  grn_locked: boolean | null;
};

export type SkuCostComponentRow = {
  fsn_id: string;
  weight_unit: string;
  pm_cost: number | null;
  fml_dump: number | null;
  pc: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Flattened row for UI — header + detail merged (legacy pricing_sheet shape). */
export type PricingSheetRow = {
  /** price_sheet_details.price_sheet_details_id */
  id?: string;
  delivery_date: string;
  city: string;
  city_id: number | null;
  fsn_id: string | null;
  weight_unit: string | null;
  /** Original Supabase weight_unit before MySQL enrichment (client-only, not a DB column). */
  weight_unit_db?: string | null;
  sku_id: string | null;
  sku_name: string | null;
  cf: number | null;
  bucket: string | null;
  subcategory: string | null;

  // demand
  demand_units: number | null;
  demand_pct: number | null;

  // GRN
  grn_price_per_kg: number | null;
  grn_price_per_unit: number | null;
  prev_grn_price_per_kg: number | null;
  prev_grn_price_per_unit: number | null;
  t3_grn_price_per_kg: number | null;
  t3_grn_price_per_unit: number | null;
  grn_diff: number | null;

  // editable
  blinkit_sp: number | null;
  adjusted_grn: number | null;
  quoted_pp: number | null;
  negotiated_pp: number | null;

  // lock flags (persisted per-cell)
  adjusted_grn_locked: boolean | null;
  quoted_locked: boolean | null;
  negotiated_locked: boolean | null;
  blinkit_sp_locked: boolean | null;
  grn_locked: boolean | null;

  // cost components
  pm_cost: number | null;
  fml_dump: number | null;
  pc: number | null;

  // derived
  nlc: number | null;
  nlc_negotiated?: number | null;
  pi_pct: number | null;
  pi_pct_quoted?: number | null;
  pi_pct_negotiated?: number | null;
  gm: number | null;
  deflection_pct: number | null;
  impact_pp_diff: number | null;
  impact_gm: number | null;
  bk_value_mix: number | null;

  // workflow
  submitted: boolean | null;

  created_at?: string | null;
  updated_at?: string | null;
};

export type SubcategoryRow = {
  subcategory: string;
  sku_id: string;
  fsn_id: string;
};

export type GuardrailRow = {
  city: string;
  pi_min: number | null;
  pi_max: number | null;
  gm_target: number | null;
  deflection_target: number | null;
  updated_at?: string | null;
};

export const DEFAULT_GUARDRAILS: Omit<GuardrailRow, "city"> = {
  pi_min: 24,
  pi_max: 26,
  gm_target: 6.05,
  deflection_target: 8,
};
