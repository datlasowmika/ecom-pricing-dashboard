import { fetchPriceSheetHeader, fetchPriceSheetDetails, mergeHeaderAndDetails } from "@/lib/priceSheetDb";
import { supabase, type PricingSheetRow } from "@/lib/supabase";

/**
 * Exhaustive value columns that can change from a lock (direct edit, UI cascade, or DB trigger).
 *
 * Dependency map (editable → auto-calculated):
 * - grn_price_per_kg → grn_price_per_unit, grn_diff, gm, impact_pp_diff, impact_gm
 * - adjusted_grn → grn_diff; and on lock may set quoted_pp / negotiated_pp → full PP cascade
 * - blinkit_sp → pi_pct, pi_pct_quoted, pi_pct_negotiated, bk_value_mix
 * - quoted_pp → nlc (quoted path), pi_pct_quoted, impact_pp_diff, impact_gm;
 *               on lock also forces negotiated_pp → full negotiated cascade
 * - negotiated_pp → nlc, nlc_negotiated, pi_pct, pi_pct_negotiated, gm
 */
export const AUDIT_VALUE_COLUMNS = [
  "grn_price_per_kg",
  "grn_price_per_unit",
  "grn_diff",
  "blinkit_sp",
  "adjusted_grn",
  "quoted_pp",
  "negotiated_pp",
  "nlc",
  "nlc_negotiated",
  "pi_pct",
  "pi_pct_quoted",
  "pi_pct_negotiated",
  "gm",
  "deflection_pct",
  "impact_pp_diff",
  "impact_gm",
  "bk_value_mix",
] as const satisfies ReadonlyArray<keyof PricingSheetRow>;

export type AuditValueColumn = (typeof AUDIT_VALUE_COLUMNS)[number];

/** User-editable columns that can appear in a lock patch. */
export const AUDIT_EDITABLE_COLUMNS = [
  "grn_price_per_kg",
  "adjusted_grn",
  "blinkit_sp",
  "quoted_pp",
  "negotiated_pp",
] as const satisfies ReadonlyArray<AuditValueColumn>;

/**
 * Every column that must be written when an editable field is locked.
 * Includes the editable itself plus all auto-calculated dependents.
 */
export const EDIT_AFFECTS: Record<
  (typeof AUDIT_EDITABLE_COLUMNS)[number],
  readonly AuditValueColumn[]
> = {
  grn_price_per_kg: [
    "grn_price_per_kg",
    "grn_price_per_unit",
    "grn_diff",
    "gm",
    "impact_pp_diff",
    "impact_gm",
  ],
  adjusted_grn: [
    "adjusted_grn",
    "grn_diff",
    "quoted_pp",
    "negotiated_pp",
    "nlc",
    "nlc_negotiated",
    "pi_pct",
    "pi_pct_quoted",
    "pi_pct_negotiated",
    "gm",
    "impact_pp_diff",
    "impact_gm",
  ],
  blinkit_sp: [
    "blinkit_sp",
    "pi_pct",
    "pi_pct_quoted",
    "pi_pct_negotiated",
    "bk_value_mix",
  ],
  quoted_pp: [
    "quoted_pp",
    "negotiated_pp",
    "nlc",
    "nlc_negotiated",
    "pi_pct",
    "pi_pct_quoted",
    "pi_pct_negotiated",
    "gm",
    "impact_pp_diff",
    "impact_gm",
  ],
  negotiated_pp: [
    "negotiated_pp",
    "nlc",
    "nlc_negotiated",
    "pi_pct",
    "pi_pct_negotiated",
    "gm",
  ],
};

/** Derived columns — always taken from client cascade, never stale/null DB copies. */
const CASCADE_ONLY_COLUMNS: ReadonlySet<AuditValueColumn> = new Set([
  "grn_price_per_unit",
  "grn_diff",
  "nlc",
  "nlc_negotiated",
  "pi_pct",
  "pi_pct_quoted",
  "pi_pct_negotiated",
  "gm",
  "impact_pp_diff",
  "impact_gm",
  "bk_value_mix",
]);

/** Audit row — revision_id is the primary key; sparse value columns only. */
export type PricingSheetAuditRow = {
  revision_id: string;
  /** 0 = current lock, 1 = previous/historical */
  revision_type: 0 | 1;
  price_sheet_details_id: string;
  price_sheet_id: string;
  delivery_date?: string | null;
  city?: string | null;
  city_id?: number | null;
  fsn_id?: string | null;
  weight_unit?: string | null;
  sku_id?: string | null;
  sku_name?: string | null;
  cf?: number | null;
  bucket?: string | null;
  subcategory?: string | null;
  demand_units?: number | null;
  demand_pct?: number | null;
  grn_price_per_kg?: number | null;
  grn_price_per_unit?: number | null;
  prev_grn_price_per_kg?: number | null;
  prev_grn_price_per_unit?: number | null;
  t3_grn_price_per_kg?: number | null;
  t3_grn_price_per_unit?: number | null;
  grn_diff?: number | null;
  blinkit_sp?: number | null;
  adjusted_grn?: number | null;
  quoted_pp?: number | null;
  negotiated_pp?: number | null;
  adjusted_grn_locked?: boolean | null;
  quoted_locked?: boolean | null;
  negotiated_locked?: boolean | null;
  blinkit_sp_locked?: boolean | null;
  grn_locked?: boolean | null;
  pm_cost?: number | null;
  fml_dump?: number | null;
  pc?: number | null;
  nlc?: number | null;
  nlc_negotiated?: number | null;
  pi_pct?: number | null;
  pi_pct_quoted?: number | null;
  pi_pct_negotiated?: number | null;
  gm?: number | null;
  deflection_pct?: number | null;
  impact_pp_diff?: number | null;
  impact_gm?: number | null;
  bk_value_mix?: number | null;
  submitted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) < 1e-6;
  }
  return a === b;
}

/** Pick audit value columns from a pricing_sheet row (raw DB values only). */
export function pickAuditColumns(
  row: Partial<PricingSheetRow> | null | undefined,
): Partial<Pick<PricingSheetRow, AuditValueColumn>> {
  const out: Partial<Pick<PricingSheetRow, AuditValueColumn>> = {};
  if (!row) return out;
  for (const col of AUDIT_VALUE_COLUMNS) {
    if (col in row && row[col] !== undefined) {
      (out as Record<string, unknown>)[col] = row[col];
    }
  }
  return out;
}

/**
 * Client-side cascade snapshot — mirrors PricingDashboard deriveRow + DB trigger variants.
 * Uses raw nulls (does not invent negotiated from quoted).
 */
export function computeClientCascadeFields(args: {
  grnPricePerKg: number | null;
  cf: number;
  adjustedGrn: number;
  blinkitSp: number | null;
  quotedPp: number | null;
  negotiatedPp: number | null;
  prevGrnPerUnit: number | null;
  pmCost: number;
  fmlDump: number;
  pc: number;
  demandUnits: number;
  demandPct: number;
  deflectionPct: number | null;
}): Partial<Pick<PricingSheetRow, AuditValueColumn>> {
  const {
    grnPricePerKg,
    cf,
    adjustedGrn,
    blinkitSp,
    quotedPp,
    negotiatedPp,
    prevGrnPerUnit,
    pmCost,
    fmlDump,
    pc,
    demandUnits,
    demandPct,
    deflectionPct,
  } = args;

  const grnPerUnit = grnPricePerKg !== null ? grnPricePerKg * cf : null;
  const effectiveGrn = grnPerUnit !== null ? grnPerUnit + adjustedGrn : null;
  const grnDiff =
    effectiveGrn !== null && prevGrnPerUnit !== null ? effectiveGrn - prevGrnPerUnit : null;

  const costs = pmCost + fmlDump + pc;
  const nlcQuoted = quotedPp !== null ? quotedPp + costs : null;
  const nlcNegotiated = negotiatedPp !== null ? negotiatedPp + costs : null;
  // Sheet NLC follows negotiated when present; otherwise quoted (same as UI when negotiated is set).
  const nlc = nlcNegotiated ?? nlcQuoted;

  const piQuoted =
    blinkitSp && nlcQuoted !== null ? ((blinkitSp - nlcQuoted) / blinkitSp) * 100 : null;
  const piNegotiated =
    blinkitSp && nlcNegotiated !== null ? ((blinkitSp - nlcNegotiated) / blinkitSp) * 100 : null;
  const piPct = piNegotiated ?? piQuoted;

  const gm = grnPerUnit !== null && nlc !== null ? nlc - grnPerUnit : null;
  const impactPpDiff =
    grnPerUnit !== null && quotedPp !== null
      ? (quotedPp - grnPerUnit) * (demandPct / 100)
      : null;
  const impactGmBase =
    grnPerUnit !== null && nlcQuoted !== null ? nlcQuoted - grnPerUnit : null;
  const impactGm =
    impactGmBase !== null ? impactGmBase * (demandPct / 100) : null;
  const bkValueMix = blinkitSp !== null ? blinkitSp * demandUnits : null;

  return {
    grn_price_per_kg: grnPricePerKg,
    grn_price_per_unit: grnPerUnit,
    grn_diff: grnDiff,
    blinkit_sp: blinkitSp,
    adjusted_grn: adjustedGrn,
    quoted_pp: quotedPp,
    negotiated_pp: negotiatedPp,
    nlc,
    nlc_negotiated: nlcNegotiated,
    pi_pct: piPct,
    pi_pct_quoted: piQuoted,
    pi_pct_negotiated: piNegotiated,
    gm,
    deflection_pct: deflectionPct,
    impact_pp_diff: impactPpDiff,
    impact_gm: impactGm,
    bk_value_mix: bkValueMix,
  };
}

/**
 * Full audit snapshot for a row.
 * Editable fields come from DB/overlay; derived fields ALWAYS from cascade math
 * so we never miss auto-calcs the DB trigger left null or stale.
 */
export function buildExhaustiveAuditSnapshot(
  dbRow: Partial<PricingSheetRow> | null | undefined,
  overlay?: Partial<PricingSheetRow>,
): Partial<Pick<PricingSheetRow, AuditValueColumn>> {
  const merged: Partial<PricingSheetRow> = { ...(dbRow ?? {}), ...(overlay ?? {}) };
  const cascade = computeClientCascadeFields({
    grnPricePerKg: merged.grn_price_per_kg ?? null,
    cf: merged.cf ?? 1,
    adjustedGrn: merged.adjusted_grn ?? 0,
    blinkitSp: merged.blinkit_sp ?? null,
    quotedPp: merged.quoted_pp ?? null,
    negotiatedPp: merged.negotiated_pp ?? null,
    prevGrnPerUnit: merged.prev_grn_price_per_unit ?? null,
    pmCost: merged.pm_cost ?? 0,
    fmlDump: merged.fml_dump ?? 0,
    pc: merged.pc ?? 0,
    demandUnits: merged.demand_units ?? 0,
    demandPct: merged.demand_pct ?? 0,
    deflectionPct: merged.deflection_pct ?? null,
  });

  const fromDb = pickAuditColumns(merged);
  const out: Partial<Pick<PricingSheetRow, AuditValueColumn>> = {};

  for (const col of AUDIT_VALUE_COLUMNS) {
    if (CASCADE_ONLY_COLUMNS.has(col)) {
      (out as Record<string, unknown>)[col] = cascade[col] ?? null;
      continue;
    }
    // Editable / stored fields: overlay/DB first, else cascade.
    const dbVal = fromDb[col];
    if (dbVal !== undefined && dbVal !== null) {
      (out as Record<string, unknown>)[col] = dbVal;
    } else if (cascade[col] !== undefined) {
      (out as Record<string, unknown>)[col] = cascade[col];
    } else {
      (out as Record<string, unknown>)[col] = null;
    }
  }
  return out;
}

/** Columns forced into the audit when a given lock patch is applied. */
export function affectedColumnsForLockPatch(
  lockPatch: Partial<PricingSheetRow> | null | undefined,
): Set<AuditValueColumn> {
  const affected = new Set<AuditValueColumn>();
  if (!lockPatch) return affected;
  for (const editable of AUDIT_EDITABLE_COLUMNS) {
    if (editable in lockPatch && lockPatch[editable] !== undefined) {
      for (const col of EDIT_AFFECTS[editable]) affected.add(col);
    }
  }
  // Quoted lock also writes negotiated in the same patch → already covered by quoted_pp map.
  return affected;
}

/** Sparse delta of every audit column whose after value differs from before. */
export function buildSparseAuditDelta(
  before: Partial<PricingSheetRow> | null | undefined,
  after: Partial<PricingSheetRow> | null | undefined,
  valueSide: "before" | "after" = "after",
): Partial<Pick<PricingSheetRow, AuditValueColumn>> {
  const delta: Partial<Pick<PricingSheetRow, AuditValueColumn>> = {};
  const left = before ?? {};
  const right = after ?? {};
  for (const col of AUDIT_VALUE_COLUMNS) {
    const prev = left[col];
    const next = right[col];
    if (prev === undefined && next === undefined) continue;
    if (!valuesEqual(prev, next)) {
      const chosen = valueSide === "before" ? prev : next;
      (delta as Record<string, unknown>)[col] = chosen ?? null;
    }
  }
  return delta;
}

/**
 * Exhaustive lock deltas from full before/after snapshots.
 * Always includes every column in the dependency map of the locked edit(s),
 * plus any other column that actually changed.
 *
 * - `previous`: BEFORE values → history (revision_type=1)
 * - `current`: AFTER values → current snapshot (revision_type=0)
 *
 * Example: GRN 8→10 stores previous {grn:8, grn_unit, gm, impacts…}
 * and current {grn:10, grn_unit, gm, impacts…}.
 */
export function buildExhaustiveLockDeltas(args: {
  beforeDb: Partial<PricingSheetRow> | null | undefined;
  afterDb: Partial<PricingSheetRow> | null | undefined;
  /** Fields written in this lock (applied on top of afterDb for cascade). */
  lockPatch?: Partial<PricingSheetRow>;
}): {
  previous: Partial<Pick<PricingSheetRow, AuditValueColumn>>;
  current: Partial<Pick<PricingSheetRow, AuditValueColumn>>;
} {
  const beforeSnap = buildExhaustiveAuditSnapshot(args.beforeDb);
  const afterSnap = buildExhaustiveAuditSnapshot(args.afterDb, args.lockPatch);

  const affected = affectedColumnsForLockPatch(args.lockPatch);
  for (const col of AUDIT_VALUE_COLUMNS) {
    if (!valuesEqual(beforeSnap[col], afterSnap[col])) affected.add(col);
  }

  const previous: Partial<Pick<PricingSheetRow, AuditValueColumn>> = {};
  const current: Partial<Pick<PricingSheetRow, AuditValueColumn>> = {};

  for (const col of affected) {
    const beforeVal = (beforeSnap[col] as number | null | undefined) ?? null;
    const afterVal = (afterSnap[col] as number | null | undefined) ?? null;
    // Only persist columns that actually changed (includes auto-calcs that moved).
    if (valuesEqual(beforeVal, afterVal)) continue;
    (previous as Record<string, unknown>)[col] = beforeVal;
    (current as Record<string, unknown>)[col] = afterVal;
  }

  return { previous, current };
}

/** @deprecated use buildExhaustiveLockDeltas — kept for any stray callers */
export function buildExhaustiveLockDelta(args: {
  beforeDb: Partial<PricingSheetRow> | null | undefined;
  afterDb: Partial<PricingSheetRow> | null | undefined;
  lockPatch?: Partial<PricingSheetRow>;
}): Partial<Pick<PricingSheetRow, AuditValueColumn>> {
  return buildExhaustiveLockDeltas(args).current;
}

export async function fetchPricingSheetRow(args: {
  city: string;
  deliveryDate: string;
  fsnId: string;
  weightUnit: string;
}): Promise<PricingSheetRow | null> {
  const header = await fetchPriceSheetHeader(args.city, args.deliveryDate);
  if (!header) return null;
  const details = await fetchPriceSheetDetails(header.price_sheet_id);
  const row = details.find(
    (d) => d.fsn_id === args.fsnId && d.weight_unit === args.weightUnit,
  );
  if (!row) return null;
  return mergeHeaderAndDetails(header, [row])[0];
}

/**
 * On lock:
 * 1. Insert revision_type=1 with PREVIOUS values of every changed column
 *    (so 8→10 records 8 in history immediately).
 * 2. Replace revision_type=0 with AFTER values (current audit snapshot).
 * 3. Keep at most 3 historical (type=1) rows — drop oldest.
 */
export async function recordLockAudit(args: {
  priceSheetDetailsId: string;
  priceSheetId: string;
  city: string;
  deliveryDate: string;
  fsnId: string;
  weightUnit: string;
  cityId?: number | null;
  skuId?: string | null;
  /** BEFORE values of changed columns → history */
  previousDelta: Partial<Pick<PricingSheetRow, AuditValueColumn>>;
  /** AFTER values of changed columns → current snapshot */
  currentDelta: Partial<Pick<PricingSheetRow, AuditValueColumn>>;
}): Promise<PricingSheetAuditRow | null> {
  if (
    Object.keys(args.previousDelta).length === 0 &&
    Object.keys(args.currentDelta).length === 0
  ) {
    return null;
  }

  const identity = {
    price_sheet_details_id: args.priceSheetDetailsId,
    price_sheet_id: args.priceSheetId,
    delivery_date: args.deliveryDate,
    city: args.city,
    city_id: args.cityId ?? null,
    fsn_id: args.fsnId,
    weight_unit: args.weightUnit,
    sku_id: args.skuId ?? null,
  };

  // 1) History row = previous values (what the user just replaced).
  if (Object.keys(args.previousDelta).length > 0) {
    const { error: histErr } = await supabase.from("pricing_sheet_audit").insert({
      revision_type: 1,
      revision_id: crypto.randomUUID(),
      ...identity,
      ...args.previousDelta,
    });
    if (histErr) throw histErr;
  }

  // 2) Replace current snapshot (type 0) with after values.
  await supabase
    .from("pricing_sheet_audit")
    .delete()
    .eq("price_sheet_details_id", args.priceSheetDetailsId)
    .eq("revision_type", 0);

  let currentRow: PricingSheetAuditRow | null = null;
  if (Object.keys(args.currentDelta).length > 0) {
    const { data, error } = await supabase
      .from("pricing_sheet_audit")
      .insert({
        revision_type: 0,
        revision_id: crypto.randomUUID(),
        ...identity,
        ...args.currentDelta,
      })
      .select("*")
      .single();
    if (error) throw error;
    currentRow = data as PricingSheetAuditRow;
  }

  // 3) Cap historical rows at 3 (newest kept).
  const { data: historical, error: histListErr } = await supabase
    .from("pricing_sheet_audit")
    .select("revision_id, created_at")
    .eq("price_sheet_details_id", args.priceSheetDetailsId)
    .eq("revision_type", 1)
    .order("created_at", { ascending: false });

  if (!histListErr && historical && historical.length > 3) {
    const dropIds = historical.slice(3).map((r) => r.revision_id);
    if (dropIds.length) {
      await supabase.from("pricing_sheet_audit").delete().in("revision_id", dropIds);
    }
  }

  return currentRow;
}

/**
 * Last `limit` previous lock changes only (revision_type = 1).
 * These hold the BEFORE values of each change — never the live current row.
 */
export async function fetchRowAuditHistory(args: {
  priceSheetDetailsId: string;
  limit?: number;
}): Promise<PricingSheetAuditRow[]> {
  const limit = args.limit ?? 3;
  const { data, error } = await supabase
    .from("pricing_sheet_audit")
    .select("*")
    .eq("price_sheet_details_id", args.priceSheetDetailsId)
    .eq("revision_type", 1)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PricingSheetAuditRow[];
}

export function auditRowKey(fsnId: string, weightUnit: string) {
  return `${fsnId}||${weightUnit}`;
}

/** Format a sparse audit cell; empty string when the column was not part of that change. */
export function formatSparseAuditCell(
  entry: PricingSheetAuditRow,
  column: AuditValueColumn | "demand_pct" | "demand_units" | "sku_name" | "cf" | "subcategory" | "bucket",
): string {
  const raw = entry[column as keyof PricingSheetAuditRow];
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "number") return String(raw);
  if (
    column === "pi_pct" ||
    column === "pi_pct_quoted" ||
    column === "pi_pct_negotiated" ||
    column === "deflection_pct" ||
    column === "demand_pct"
  ) {
    return `${raw.toFixed(column === "demand_pct" ? 3 : 2)}%`;
  }
  if (column === "grn_diff" || column === "adjusted_grn") {
    return `${raw >= 0 ? "+" : ""}${raw.toFixed(2)}`;
  }
  if (column === "bk_value_mix" || column === "demand_units") {
    return column === "demand_units"
      ? Math.round(raw).toLocaleString()
      : `₹${Math.round(raw).toLocaleString()}`;
  }
  if (column === "cf") return raw.toFixed(2);
  return `₹${Number(raw).toFixed(2)}`;
}

/** GRN Markup is display-only; show when either quoted or grn/unit changed in the sparse row. */
export function formatAuditGrnMarkup(
  entry: PricingSheetAuditRow,
  fallbackQuoted: number | null,
  fallbackGrnPerUnit: number | null,
): string {
  const quoted = entry.quoted_pp ?? fallbackQuoted;
  const grnUnit = entry.grn_price_per_unit ?? fallbackGrnPerUnit;
  if (entry.quoted_pp == null && entry.grn_price_per_unit == null) return "";
  if (quoted == null || grnUnit == null) return "";
  return `₹${(quoted - grnUnit).toFixed(2)}`;
}
