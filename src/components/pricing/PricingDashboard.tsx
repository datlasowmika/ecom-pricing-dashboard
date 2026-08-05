import { useMemo, useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { supabase, type PricingSheetRow } from "@/lib/supabase";
import { usePricingSheet } from "@/hooks/usePricingSheet";
import { useSubcategories } from "@/hooks/useSubcategories";
import { useGuardrails } from "@/hooks/useGuardrails";
import { parseCSV, toNum, toInt } from "@/lib/csv";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Lock,
  Unlock,
  AlertTriangle,
  Upload,
  Download,
  Plus,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  X,
  Search,
  LayoutDashboard,
  Tags,
  TrendingUp,
  Settings,
  Package,
  FileSpreadsheet,
  Calendar,
  Filter,
  Layers,
  Check,
  Maximize2,
  Minimize2,
} from "lucide-react";

const TABLE_ZOOM_MIN = 50;
const TABLE_ZOOM_MAX = 100;

function TableZoomControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const clamp = (n: number) =>
    Math.min(TABLE_ZOOM_MAX, Math.max(TABLE_ZOOM_MIN, Math.round(n)));

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onChange(clamp(value + (e.deltaY < 0 ? 1 : -1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [value, onChange]);

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-2"
      title="Drag slider or scroll to adjust zoom"
    >
      <span className="shrink-0 text-[11px] text-muted-foreground">Zoom</span>
      <input
        type="range"
        min={TABLE_ZOOM_MIN}
        max={TABLE_ZOOM_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer accent-primary"
        aria-label="Table zoom"
        aria-valuemin={TABLE_ZOOM_MIN}
        aria-valuemax={TABLE_ZOOM_MAX}
        aria-valuenow={value}
      />
      <span className="min-w-[2.25rem] text-right text-[11px] tabular-nums text-muted-foreground">
        {value}%
      </span>
    </div>
  );
}

// ---------- Types ----------
type SkuRow = {
  fsnId: string;
  skuId?: string;
  ncSkuId: string;
  ncSkuName: string;
  subcategory: string;
  weightUnit: string;
  pointOfProcurement: string;
  conversionFactor: number;
  specialTag: string | null;
  demandUnits: number;
  piMixPct: number;
  grnPricePerKg: number | null;
  prevDayGrnPerKg?: number | null;
  prevDayGrnPerUnit?: number | null;
  grnLocked?: boolean;
  grnWarning?: boolean;
  blinkitSp: number | null;
  blinkitLocked?: boolean;
  adjustedGrn?: number;
  adjustedGrnLocked?: boolean;
  wspTrend?: "up" | "down" | "flat";
  quotedPp: number;
  quotedLocked: boolean;
  quotedTouched: boolean;
  negotiatedPp: number;
  negotiatedLocked: boolean;
  negotiatedTouched: boolean;
  lastLockedNegotiated: number;
  suggestedPp: number | null;
  suggestionAcknowledgedAt: number;
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  priceDeflectionPct: number;
};

const SEED: SkuRow[] = [
  { fsnId: "FSN1001", ncSkuId: "NC-APL-01", ncSkuName: "Apple Shimla Premium",       subcategory: "Fruits",   weightUnit: "1 - Pc of Apple Shimla Premium (1 kg Pack)(PCS) - FK lot",     pointOfProcurement: "Shimla",     conversionFactor: 1.0,  specialTag: "Seasonal", demandUnits: 1820, piMixPct: 8.4,  grnPricePerKg: 142, blinkitSp: 189, quotedPp: 142, quotedLocked: false, quotedTouched: false, negotiatedPp: 142, negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 142, suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 6, fmlCost: 4, processingCost: 3, priceDeflectionPct: 4.2 },
  { fsnId: "FSN1002", ncSkuId: "NC-BAN-02", ncSkuName: "Banana Robusta",             subcategory: "Fruits",   weightUnit: "1 - Pc of Banana Robusta (1 dozen Pack)(PCS) - FK lot",       pointOfProcurement: "Vijayawada", conversionFactor: 1.2,  specialTag: null,       demandUnits: 3240, piMixPct: 12.1, grnPricePerKg: 38,  blinkitSp: 59,  quotedPp: 46,  quotedLocked: false, quotedTouched: false, negotiatedPp: 46,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 46,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 3, fmlCost: 2, processingCost: 2, priceDeflectionPct: 3.1 },
  { fsnId: "FSN1003", ncSkuId: "NC-TOM-03", ncSkuName: "Tomato Hybrid",              subcategory: "Vegetables",weightUnit: "1 - Pc of Tomato Hybrid (500 g Pack)(PCS) - FK lot",         pointOfProcurement: "Kolar",     conversionFactor: 0.5,  specialTag: null,       demandUnits: 2980, piMixPct: 11.4, grnPricePerKg: 24,  blinkitSp: null, quotedPp: 12,  quotedLocked: false, quotedTouched: false, negotiatedPp: 12,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 12,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 2, fmlCost: 1, processingCost: 1, priceDeflectionPct: 9.6 },
  { fsnId: "FSN1004", ncSkuId: "NC-ONI-04", ncSkuName: "Onion Nasik",                subcategory: "Vegetables",weightUnit: "1 - Pc of Onion Nasik (1 kg Pack)(PCS) - FK lot",             pointOfProcurement: "Nashik",    conversionFactor: 1.0,  specialTag: null,       demandUnits: 4120, piMixPct: 15.2, grnPricePerKg: null,blinkitSp: 42,  quotedPp: 36,  quotedLocked: false, quotedTouched: false, negotiatedPp: 36,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 36,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 3, fmlCost: 2, processingCost: 2, priceDeflectionPct: 5.4, grnWarning: true },
  { fsnId: "FSN1005", ncSkuId: "NC-POT-05", ncSkuName: "Potato Jyoti",               subcategory: "Vegetables",weightUnit: "1 - Pc of Potato Jyoti (1 kg Pack)(PCS) - FK lot",            pointOfProcurement: "Agra",      conversionFactor: 1.0,  specialTag: null,       demandUnits: 3650, piMixPct: 13.6, grnPricePerKg: 22,  blinkitSp: 31,  quotedPp: 22,  quotedLocked: false, quotedTouched: false, negotiatedPp: 22,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 22,  suggestedPp: 26,  suggestionAcknowledgedAt: 0, packagingCost: 2, fmlCost: 2, processingCost: 1, priceDeflectionPct: 2.4 },
  { fsnId: "FSN1006", ncSkuId: "NC-MAN-06", ncSkuName: "Mango Alphonso",             subcategory: "Fruits",   weightUnit: "1 - Pc of Mango Alphonso (1 kg Pack)(PCS) - FK lot",          pointOfProcurement: "Ratnagiri", conversionFactor: 1.0,  specialTag: "Summer",   demandUnits: 980,  piMixPct: 4.1,  grnPricePerKg: 420, blinkitSp: 549, quotedPp: 420, quotedLocked: false, quotedTouched: false, negotiatedPp: 420, negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 420, suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 12,fmlCost: 8, processingCost: 6, priceDeflectionPct: 8.7 },
  { fsnId: "FSN1007", ncSkuId: "NC-CUC-07", ncSkuName: "Cucumber English",           subcategory: "Vegetables",weightUnit: "1 - Pc of Cucumber English (500 g Pack)(PCS) - FK lot",      pointOfProcurement: "Pune",      conversionFactor: 0.5,  specialTag: null,       demandUnits: 1420, piMixPct: 5.6,  grnPricePerKg: 36,  blinkitSp: null, quotedPp: 18,  quotedLocked: false, quotedTouched: false, negotiatedPp: 18,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 18,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 2, fmlCost: 1, processingCost: 1, priceDeflectionPct: 1.8 },
  { fsnId: "FSN1008", ncSkuId: "NC-CAR-08", ncSkuName: "Carrot Ooty",                subcategory: "Vegetables",weightUnit: "1 - Pc of Carrot Ooty (500 g Pack)(PCS) - FK lot",            pointOfProcurement: "Ooty",      conversionFactor: 0.5,  specialTag: null,       demandUnits: 1180, piMixPct: 4.4,  grnPricePerKg: 52,  blinkitSp: 38,  quotedPp: 26,  quotedLocked: false, quotedTouched: false, negotiatedPp: 26,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 26,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 2, fmlCost: 2, processingCost: 1, priceDeflectionPct: 6.2 },
  { fsnId: "FSN1009", ncSkuId: "NC-SPI-09", ncSkuName: "Spinach Bunch",              subcategory: "Greens",   weightUnit: "1 - Pc of Spinach Bunch (250 g Pack)(PCS) - FK lot",          pointOfProcurement: "Hosur",     conversionFactor: 0.25, specialTag: null,       demandUnits: 860,  piMixPct: 3.2,  grnPricePerKg: 60,  blinkitSp: 29,  quotedPp: 15,  quotedLocked: false, quotedTouched: false, negotiatedPp: 15,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 15,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 1, fmlCost: 1, processingCost: 1, priceDeflectionPct: 11.4 },
  { fsnId: "FSN1010", ncSkuId: "NC-PAP-10", ncSkuName: "Papaya Ripe",                subcategory: "Fruits",   weightUnit: "1 - Pc of Papaya Ripe (1 kg Pack)(PCS) - FK lot",             pointOfProcurement: "Madanapalle",conversionFactor: 1.0, specialTag: "Seasonal", demandUnits: 1330, piMixPct: 5.0,  grnPricePerKg: 34,  blinkitSp: 49,  quotedPp: 34,  quotedLocked: false, quotedTouched: false, negotiatedPp: 34,  negotiatedLocked: false, negotiatedTouched: false, lastLockedNegotiated: 34,  suggestedPp: null, suggestionAcknowledgedAt: 0, packagingCost: 3, fmlCost: 2, processingCost: 2, priceDeflectionPct: 4.6 },
];

const CITIES = ["Bengaluru", "Chennai", "Coimbatore", "Hyderabad", "Mumbai", "Nashik", "Trichy"];
const TABS = ["Price Upload", "Price Approval", "Demand Upload", "SKU Configuration", "Guardrails"];

const VIOLATIONS: { key: string; label: string }[] = [
  { key: "all", label: "All SKUs" },
  { key: "neg_pi", label: "Negative PI %" },
  { key: "neg_gm", label: "Negative GM" },
  { key: "blank_bk", label: "Blank Blinkit SP" },
  { key: "missing_grn", label: "Missing GRN" },
  { key: "has_suggested", label: "Has Suggested PP" },
  { key: "high_deflection", label: "Deflection out of range (±8%)" },
];

const DEFLECTION_MIN = -8;
const DEFLECTION_MAX = 8;

function isDeflectionOutOfRange(pct: number, min = DEFLECTION_MIN, max = DEFLECTION_MAX) {
  return pct < min || pct > max;
}

const fmt = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `₹${n.toFixed(d)}`;
const num = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toFixed(d);

const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Map a Supabase pricing_sheet row into the UI SkuRow shape.
function dbToSku(r: PricingSheetRow): SkuRow {
  return {
    fsnId: r.fsn_id ?? r.id ?? "",
    skuId: r.sku_id ?? undefined,
    ncSkuId: r.sku_id ?? "",
    ncSkuName: r.sku_name ?? "",
    subcategory: r.subcategory ?? "",
    weightUnit: r.weight_unit ?? "",
    pointOfProcurement: r.bucket ?? "",
    conversionFactor: r.cf ?? 1,
    specialTag: r.bucket ?? null,
    demandUnits: r.demand_units ?? 0,
    piMixPct: r.demand_pct ?? 0,
    grnPricePerKg: r.grn_price_per_kg,
    prevDayGrnPerKg: r.prev_grn_price_per_kg,
    prevDayGrnPerUnit: r.prev_grn_price_per_unit,
    grnLocked: true,
    grnWarning: r.grn_price_per_kg === null,
    blinkitSp: r.blinkit_sp,
    blinkitLocked: true,
    adjustedGrn: r.adjusted_grn ?? 0,
    adjustedGrnLocked: true,
    wspTrend: "flat",
    quotedPp: r.quoted_pp ?? 0,
    quotedLocked: true,
    quotedTouched: false,
    negotiatedPp: r.negotiated_pp ?? r.quoted_pp ?? 0,
    negotiatedLocked: true,
    negotiatedTouched: false,
    lastLockedNegotiated: r.negotiated_pp ?? r.quoted_pp ?? 0,
    suggestedPp: null,
    suggestionAcknowledgedAt: 0,
    packagingCost: r.pm_cost ?? 0,
    fmlCost: r.fml_dump ?? 0,
    processingCost: r.pc ?? 0,
    priceDeflectionPct: r.deflection_pct ?? 0,
  };
}


// ---------- Derived row math ----------
function deriveRow(r: SkuRow, totalDemand: number) {
  const grnPerUnit = r.grnPricePerKg !== null ? r.grnPricePerKg * r.conversionFactor : null;
  const adj = r.adjustedGrn ?? 0;
  const effectiveGrnPerUnit = grnPerUnit !== null ? grnPerUnit + adj : null;
  const grnDiff =
    effectiveGrnPerUnit !== null && r.prevDayGrnPerUnit !== null && r.prevDayGrnPerUnit !== undefined
      ? effectiveGrnPerUnit - r.prevDayGrnPerUnit
      : null;
  const nlc = r.negotiatedPp + r.packagingCost + r.fmlCost + r.processingCost;
  const piPct = r.blinkitSp ? ((r.blinkitSp - nlc) / r.blinkitSp) * 100 : null;
  const gm = grnPerUnit !== null ? nlc - grnPerUnit : null;
  const totalDemandPct = totalDemand ? (r.demandUnits / totalDemand) * 100 : 0;
  const quotedNlc = r.quotedPp + r.packagingCost + r.fmlCost + r.processingCost;
  const impactGmBase = grnPerUnit !== null ? quotedNlc - grnPerUnit : null;
  const impactPpDiff =
    grnPerUnit !== null && r.piMixPct !== null
      ? (r.quotedPp - grnPerUnit) * (r.piMixPct / 100)
      : null;
  const impactGm =
    impactGmBase !== null && r.piMixPct !== null
      ? impactGmBase * (r.piMixPct / 100)
      : null;
  const valueMix = r.blinkitSp !== null ? r.blinkitSp * r.demandUnits : null;
  const nlcValueMix = nlc * r.demandUnits;
  return { grnPerUnit, prevDayGrnPerUnit: r.prevDayGrnPerUnit ?? null, grnDiff, nlc, piPct, gm, totalDemandPct, impactPpDiff, impactGm, valueMix, nlcValueMix };
}

type Enriched = { row: SkuRow; calc: ReturnType<typeof deriveRow> };

function plainSum(
  enriched: Enriched[],
  getValue: (e: Enriched) => number | null | undefined,
): number | null {
  let sum = 0;
  let has = false;
  for (const e of enriched) {
    const v = getValue(e);
    if (v === null || v === undefined) continue;
    sum += v;
    has = true;
  }
  return has ? sum : null;
}

function weightedByDemandPct(
  enriched: Enriched[],
  getValue: (e: Enriched) => number | null | undefined,
): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const e of enriched) {
    const v = getValue(e);
    if (v === null || v === undefined) continue;
    const w = e.calc.totalDemandPct;
    weightedSum += v * w;
    weightSum += w;
  }
  return weightSum > 0 ? weightedSum / weightSum : null;
}

/** Price Upload Averages — always computed over the full basket (all SKUs), never filtered rows. */
function computePriceUploadAverages(enriched: Enriched[]) {
  const wNlc = weightedByDemandPct(enriched, (e) => e.calc.nlc);
  const wGrnPerUnit = weightedByDemandPct(enriched, (e) => e.calc.grnPerUnit);

  return {
    demandUnits: plainSum(enriched, (e) => e.row.demandUnits),
    totalDemandPct: plainSum(enriched, (e) => e.calc.totalDemandPct),
    grnPricePerKg: weightedByDemandPct(enriched, (e) => e.row.grnPricePerKg),
    grnPerUnit: wGrnPerUnit,
    prevDayGrnPerKg: weightedByDemandPct(enriched, (e) => e.row.prevDayGrnPerKg ?? null),
    prevDayGrnPerUnit: weightedByDemandPct(enriched, (e) => e.calc.prevDayGrnPerUnit),
    blinkitSp: weightedByDemandPct(enriched, (e) => e.row.blinkitSp),
    nlc: wNlc,
    piPct: weightedByDemandPct(enriched, (e) => e.calc.piPct),
    priceDeflectionPct: weightedByDemandPct(enriched, (e) => e.row.priceDeflectionPct),
    impactPpDiff: plainSum(enriched, (e) => e.calc.impactPpDiff),
    impactGm: plainSum(enriched, (e) => e.calc.impactGm),
    valueMix: weightedByDemandPct(enriched, (e) => e.calc.valueMix),
    gm: wNlc !== null && wGrnPerUnit !== null ? wNlc - wGrnPerUnit : null,
    nlcValueMix: plainSum(enriched, (e) => e.calc.nlcValueMix),
    grnDiff: weightedByDemandPct(enriched, (e) => e.calc.grnDiff),
    adjustedGrn: weightedByDemandPct(enriched, (e) => e.row.adjustedGrn ?? 0),
    quotedPp: weightedByDemandPct(enriched, (e) => e.row.quotedPp),
    negotiatedPp: weightedByDemandPct(enriched, (e) => e.row.negotiatedPp),
    suggestedPp: weightedByDemandPct(enriched, (e) => e.row.suggestedPp),
  };
}

// ---------- Tooltip ----------
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex min-w-0 max-w-full">
      {children}
      {text ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {text}
        </span>
      ) : null}
    </span>
  );
}

// ---------- Sort header ----------
type SortDir = "asc" | "desc" | null;
function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: { label: string; active: boolean; dir: SortDir; onClick: () => void; align?: "left" | "right" }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-full w-full min-w-0 items-center gap-1 text-[11px] font-semibold uppercase leading-none tracking-wide text-muted-foreground hover:text-foreground ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {!active && <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />}
      {active && dir === "asc" && <ChevronUp className="h-3 w-3 shrink-0 text-primary" />}
      {active && dir === "desc" && <ChevronDown className="h-3 w-3 shrink-0 text-primary" />}
    </button>
  );
}

// ---------- Main ----------
export function PricingDashboard() {
  const [tab, setTab] = useState(0);
  const [deliveryDate, setDeliveryDate] = useState(tomorrowISO());
  const [city, setCity] = useState("Bengaluru");
  const [sheetCreated, setSheetCreated] = useState(false);
  const [rows, setRows] = useState<SkuRow[]>(() =>
    SEED.map((r, i) => ({ ...r, skuId: `SKU${r.fsnId.slice(3)}`, quotedLocked: true, negotiatedLocked: true, adjustedGrn: 0, adjustedGrnLocked: true, wspTrend: (["up","down","flat","up","flat","down","up","flat","down","up"] as const)[i], prevDayGrnPerUnit: ([140, 44, null, null, 21, 415, 17, 27, null, 33] as (number | null)[])[i] }))
  );

  // Live-load pricing_sheet rows when the user opens the sheet (Fetch/Create).
  const { rows: dbRows, updateRow: dbUpdateRow, submitSheet: dbSubmit, refetch: dbRefetch } =
    usePricingSheet({ city, deliveryDate, autoFetch: false });
  const { subcategoryNames, resolveSubcategory } = useSubcategories();

  // Lightweight existence check for Create vs Fetch button (no full sheet load).
  const [sheetExists, setSheetExists] = useState<boolean | null>(null);
  const checkSheetExists = useCallback(async () => {
    const { count, error } = await supabase
      .from("pricing_sheet")
      .select("id", { count: "exact", head: true })
      .eq("city", city)
      .eq("delivery_date", deliveryDate);
    setSheetExists(!error && (count ?? 0) > 0);
  }, [city, deliveryDate]);

  useEffect(() => {
    let cancelled = false;
    setSheetExists(null);
    (async () => {
      const { count, error } = await supabase
        .from("pricing_sheet")
        .select("id", { count: "exact", head: true })
        .eq("city", city)
        .eq("delivery_date", deliveryDate);
      if (!cancelled) setSheetExists(!error && (count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [city, deliveryDate]);

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const SAVE_MAP: Record<string, keyof PricingSheetRow> = {
    blinkitSp: "blinkit_sp",
    quotedPp: "quoted_pp",
    negotiatedPp: "negotiated_pp",
    adjustedGrn: "adjusted_grn",
    grnPricePerKg: "grn_price_per_kg",
  };

  useEffect(() => {
    // Merge DB rows into local rows so client-only fields (touched, acks) and
    // in-flight edits still awaiting a Supabase write don't get clobbered.
    setRows((prev) => {
      const prevByKey = new Map(prev.map((p) => [`${p.fsnId}||${p.weightUnit}`, p]));
      return dbRows.map((db) => {
        const fresh = dbToSku(db);
        const key = `${fresh.fsnId}||${fresh.weightUnit}`;
        const p = prevByKey.get(key);
        if (!p) return fresh;
        const pendingKey = fresh.fsnId;
        const hasPending = !!saveTimers.current[pendingKey];
        const editing =
          !p.grnLocked ||
          !p.blinkitLocked ||
          !p.adjustedGrnLocked ||
          !p.quotedLocked ||
          !p.negotiatedLocked;
        const merged: SkuRow = {
          ...fresh,
          grnLocked: p.grnLocked,
          blinkitLocked: p.blinkitLocked,
          adjustedGrnLocked: p.adjustedGrnLocked,
          quotedLocked: p.quotedLocked,
          negotiatedLocked: p.negotiatedLocked,
          quotedTouched: p.quotedTouched,
          negotiatedTouched: p.negotiatedTouched,
          lastLockedNegotiated: p.lastLockedNegotiated,
          suggestionAcknowledgedAt: p.suggestionAcknowledgedAt,
          suggestedPp: p.suggestedPp,
        };
        if (editing || hasPending) {
          if (!p.grnLocked || hasPending) merged.grnPricePerKg = p.grnPricePerKg;
          if (!p.blinkitLocked || hasPending) merged.blinkitSp = p.blinkitSp;
          if (!p.adjustedGrnLocked || hasPending) merged.adjustedGrn = p.adjustedGrn;
          if (!p.quotedLocked || hasPending) merged.quotedPp = p.quotedPp;
          if (!p.negotiatedLocked || hasPending) merged.negotiatedPp = p.negotiatedPp;
        }
        return merged;
      });
    });
    if (dbRows.length > 0 && dbRows.some((r) => r.submitted)) setSubmitted(true);
    else setSubmitted(false);
  }, [dbRows]);

  // Hide the sheet whenever the selection changes; user must click Fetch/Create to load it.
  useEffect(() => {
    setSheetCreated(false);
  }, [city, deliveryDate]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<"draft" | "created" | "pending" | "approved" | "rejected" | "modification">("draft");
  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [showFab, setShowFab] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingViolationFilters, setPendingViolationFilters] = useState<Set<string>>(new Set());
  const [appliedViolationFilters, setAppliedViolationFilters] = useState<Set<string>>(new Set());
  const [lockedViolationFsnIds, setLockedViolationFsnIds] = useState<Set<string> | null>(null);
  const [pendingSubcategoryFilters, setPendingSubcategoryFilters] = useState<Set<string>>(new Set());
  const [appliedSubcategoryFilters, setAppliedSubcategoryFilters] = useState<Set<string>>(new Set());
  const [lockedSubcategoryFsnIds, setLockedSubcategoryFsnIds] = useState<Set<string> | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [subcatFilterOpen, setSubcatFilterOpen] = useState(false);
  const [sheetFullscreen, setSheetFullscreen] = useState(false);
  const [tableZoom, setTableZoom] = useState(TABLE_ZOOM_MAX);
  const {
    width: frozenPaneWidth,
    onResizePointerDown: onFrozenResizeDown,
    onResizePointerMove: onFrozenResizeMove,
    endResize: endFrozenResize,
  } = useResizableFrozenWidth(FROZEN_PANE_DEFAULT, FROZEN_PANE_MIN, FROZEN_PANE_MAX);

  useEffect(() => {
    setPendingViolationFilters(new Set());
    setAppliedViolationFilters(new Set());
    setLockedViolationFsnIds(null);
    setPendingSubcategoryFilters(new Set());
    setAppliedSubcategoryFilters(new Set());
    setLockedSubcategoryFsnIds(null);
  }, [city, deliveryDate]);

  useEffect(() => {
    if (!sheetFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetFullscreen]);


  useEffect(() => {
    const onScroll = () => setShowFab(window.scrollY > 200);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isPreviousDate = deliveryDate < tomorrowISO();
  // Create when no sheet exists for this date+city; Fetch for past/today dates or existing sheets.
  const showCreate = sheetExists === false && !isPreviousDate;
  const maxDate = tomorrowISO();

  const totalDemand = useMemo(() => rows.reduce((s, r) => s + r.demandUnits, 0), [rows]);

  const enriched = useMemo(
    () => rows.map((r) => {
      const effective = { ...r, piMixPct: r.blinkitSp === null ? 0 : r.piMixPct };
      return { row: effective, calc: deriveRow(effective, totalDemand) };
    }),
    [rows, totalDemand]
  );

  const matchesViolationFilters = useCallback((row: SkuRow, calc: ReturnType<typeof deriveRow>, fs: Set<string>) => {
    if (fs.size === 0) return true;
    if (fs.has("neg_pi") && calc.piPct !== null && calc.piPct < 0) return true;
    if (fs.has("neg_gm") && calc.gm !== null && calc.gm < 0) return true;
    if (fs.has("blank_bk") && row.blinkitSp === null) return true;
    if (fs.has("missing_grn") && row.grnPricePerKg === null) return true;
    if (fs.has("has_suggested") && row.suggestedPp !== null) return true;
    if (fs.has("high_deflection") && isDeflectionOutOfRange(row.priceDeflectionPct)) return true;
    return false;
  }, []);

  const applyViolationFilters = useCallback(() => {
    const fs = new Set(pendingViolationFilters);
    setAppliedViolationFilters(fs);
    if (fs.size === 0) {
      setLockedViolationFsnIds(null);
    } else {
      const ids = new Set(
        enriched
          .filter(({ row, calc }) => matchesViolationFilters(row, calc, fs))
          .map(({ row }) => row.fsnId),
      );
      setLockedViolationFsnIds(ids);
    }
    setFilterOpen(false);
  }, [pendingViolationFilters, enriched, matchesViolationFilters]);

  const applySubcategoryFilters = useCallback(() => {
    const subs = new Set(pendingSubcategoryFilters);
    setAppliedSubcategoryFilters(subs);
    if (subs.size === 0) {
      setLockedSubcategoryFsnIds(null);
    } else {
      const ids = new Set(
        enriched
          .filter(({ row }) => {
            const sub = resolveSubcategory(row.fsnId, row.ncSkuId, row.subcategory);
            return !!sub && subs.has(sub);
          })
          .map(({ row }) => row.fsnId),
      );
      setLockedSubcategoryFsnIds(ids);
    }
    setSubcatFilterOpen(false);
  }, [pendingSubcategoryFilters, enriched, resolveSubcategory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter(({ row }) => {
      if (q && !(
        row.fsnId.toLowerCase().includes(q) ||
        row.ncSkuId.toLowerCase().includes(q) ||
        row.ncSkuName.toLowerCase().includes(q)
      )) return false;
      // Filter visibility is locked at Apply time (by FSN id).
      if (lockedViolationFsnIds !== null && !lockedViolationFsnIds.has(row.fsnId)) return false;
      if (lockedSubcategoryFsnIds !== null && !lockedSubcategoryFsnIds.has(row.fsnId)) return false;
      return true;
    });
  }, [enriched, search, lockedViolationFsnIds, lockedSubcategoryFsnIds]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    const get = (e: typeof enriched[number]) => {
      switch (sortKey) {
        case "demandUnits": return e.row.demandUnits;
        case "totalDemandPct": return e.calc.totalDemandPct;
        case "piMixPct": return e.row.piMixPct;
        case "grnPricePerKg": return e.row.grnPricePerKg ?? -Infinity;
        case "grnPerUnit": return e.calc.grnPerUnit ?? -Infinity;
        case "blinkitSp": return e.row.blinkitSp ?? -Infinity;
        case "adjustedGrn": return e.row.adjustedGrn ?? 0;
        case "quotedPp": return e.row.quotedPp;
        case "negotiatedPp": return e.row.negotiatedPp;
        case "nlc": return e.calc.nlc;
        case "piPct": return e.calc.piPct ?? -Infinity;
        case "gm": return e.calc.gm ?? -Infinity;
        case "priceDeflectionPct": return e.row.priceDeflectionPct;
        case "impactPpDiff": return e.calc.impactPpDiff ?? -Infinity;
        case "impactGm": return e.calc.impactGm ?? -Infinity;
        case "valueMix": return e.calc.valueMix ?? -Infinity;
        case "nlcValueMix": return e.calc.nlcValueMix ?? -Infinity;
        default: return 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = get(a), vb = get(b);
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [filtered, sortKey, sortDir]);

  const averages = useMemo(() => computePriceUploadAverages(enriched), [enriched]);

  const subcategoryOptions = useMemo(() => {
    const fromRows = new Set<string>();
    for (const r of rows) {
      const sub = resolveSubcategory(r.fsnId, r.ncSkuId, r.subcategory);
      if (sub) fromRows.add(sub);
    }
    return Array.from(new Set([...subcategoryNames, ...fromRows])).sort((a, b) => a.localeCompare(b));
  }, [subcategoryNames, rows, resolveSubcategory]);

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };

  const updateRowLocal = (fsnId: string, patch: Partial<SkuRow>) => {
    setRows((rs) => rs.map((r) => (r.fsnId === fsnId ? { ...r, ...patch } : r)));
  };

  const persistRowFields = (fsnId: string, weightUnit: string, patch: Partial<SkuRow>) => {
    const dbPatch: Partial<PricingSheetRow> = {};
    for (const [k, col] of Object.entries(SAVE_MAP)) {
      if (k in patch) (dbPatch as Record<string, unknown>)[col] = (patch as Record<string, unknown>)[k];
    }
    if (Object.keys(dbPatch).length === 0) return;
    const key = fsnId;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      dbUpdateRow({ fsn_id: fsnId, weight_unit: weightUnit }, dbPatch)
        .catch(async (e) => {
          const { toast } = await import("sonner");
          toast.error(`Save failed: ${(e as Error).message}`);
        })
        .finally(() => {
          delete saveTimers.current[key];
        });
    }, 400);
  };

  // Failed rows from the most recent bulk upload (for the Retry affordance).
  const lastBulkFailures = useRef<BulkUpdate[]>([]);
  const [bulkFailuresVersion, setBulkFailuresVersion] = useState(0);

  const runBulkApply = async (updates: BulkUpdate[]) => {
    // Resolve matching rows + patches ahead of time.
    type Job = { row: SkuRow; update: BulkUpdate; patch: Partial<SkuRow>; dbPatch: Partial<PricingSheetRow> };
    const jobs: Job[] = [];
    for (const u of updates) {
      const row = rows.find(
        (r) => r.fsnId === u.fsnId && (u.weightUnit ? r.weightUnit === u.weightUnit : true),
      );
      if (!row) continue;
      const patch: Partial<SkuRow> = {};
      if (u.blinkitSp !== undefined) patch.blinkitSp = u.blinkitSp;
      if (u.adjustedGrn !== undefined) patch.adjustedGrn = u.adjustedGrn ?? 0;
      if (u.quotedPp !== undefined && u.quotedPp !== null) { patch.quotedPp = u.quotedPp; patch.quotedTouched = true; }
      if (u.negotiatedPp !== undefined && u.negotiatedPp !== null) { patch.negotiatedPp = u.negotiatedPp; patch.negotiatedTouched = true; }
      if (u.grnPricePerKg !== undefined) patch.grnPricePerKg = u.grnPricePerKg;
      if (Object.keys(patch).length === 0) continue;
      const dbPatch: Partial<PricingSheetRow> = {};
      for (const [k, col] of Object.entries(SAVE_MAP)) {
        if (k in patch) (dbPatch as Record<string, unknown>)[col] = (patch as Record<string, unknown>)[k];
      }
      jobs.push({ row, update: u, patch, dbPatch });
    }

    const total = jobs.length;
    if (total === 0) {
      const { toast } = await import("sonner");
      toast.error("No matching rows to update");
      return;
    }

    // Merge every patch into local state up front (single re-render).
    setRows((rs) => {
      const byKey = new Map(jobs.map((j) => [`${j.row.fsnId}||${j.row.weightUnit}`, j.patch]));
      return rs.map((r) => {
        const p = byKey.get(`${r.fsnId}||${r.weightUnit}`);
        return p ? { ...r, ...p } : r;
      });
    });

    const { toast } = await import("sonner");
    const toastId = `bulk-${Date.now()}`;
    toast.loading(`Saving 0 / ${total}…`, { id: toastId });

    const failed: BulkUpdate[] = [];
    const failedDetail: { fsnId: string; weightUnit: string | null; message: string }[] = [];
    let done = 0;
    // Serialize DB updates to avoid Postgres 40P01 deadlocks under parallel row writes.
    for (const j of jobs) {
      try {
        await dbUpdateRow(
          { fsn_id: j.row.fsnId, weight_unit: j.row.weightUnit ?? null },
          j.dbPatch,
        );
      } catch (e) {
        failed.push(j.update);
        failedDetail.push({
          fsnId: j.row.fsnId,
          weightUnit: j.row.weightUnit ?? null,
          message: (e as Error).message,
        });
      }
      done++;
      if (done % 5 === 0 || done === total) {
        toast.loading(`Saving ${done} / ${total}…`, { id: toastId });
      }
    }

    lastBulkFailures.current = failed;
    setBulkFailuresVersion((v) => v + 1);

    if (failed.length === 0) {
      toast.success(`Saved ${total} rows`, { id: toastId });
    } else {
      const preview = failedDetail.slice(0, 3).map((f) => f.fsnId).join(", ");
      const suffix = failedDetail.length > 3 ? "…" : "";
      // eslint-disable-next-line no-console
      console.table(failedDetail);
      toast.error(`Saved ${total - failed.length} / ${total}. ${failed.length} rows failed`, {
        id: toastId,
        description: `Failed: ${preview}${suffix} (see console for full list)`,
        action: {
          label: "Retry failed",
          onClick: () => { void runBulkApply(failed); },
        },
      });
    }
  };

  const anyUnlockedEdit = rows.some(
    (r) =>
      !(r.grnLocked ?? true) ||
      !(r.blinkitLocked ?? true) ||
      !(r.adjustedGrnLocked ?? true) ||
      !r.quotedLocked ||
      !r.negotiatedLocked
  );
  const blockedBySuggestion = rows.some(
    (r) => r.suggestedPp !== null && (!r.negotiatedLocked || r.negotiatedPp === r.lastLockedNegotiated && r.suggestionAcknowledgedAt === 0)
  );
  const submitDisabled = anyUnlockedEdit || submitted;

  const onCreateOrFetch = async () => {
    await dbRefetch();
    await checkSheetExists();
    setSheetCreated(true);
    if (status === "draft") setStatus("created");
  };

  const onDownloadFkSheet = () => {
    // FK Sheet: header "Quoted PP" but values come from negotiatedPp per spec.
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "FSN ID,Weight Unit,Quoted PP\n";
    const body = rows
      .map((r) => `${esc(r.fsnId)},${esc(r.weightUnit)},${r.negotiatedPp ?? ""}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FK-Sheet_${deliveryDate}_${city}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    import("sonner").then(({ toast }) => toast.success("FK Sheet download started"));
  };

  const onConfirmSubmit = async () => {
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        grnLocked: true,
        blinkitLocked: true,
        adjustedGrnLocked: true,
        quotedLocked: true,
        negotiatedLocked: true,
        lastLockedNegotiated: r.negotiatedPp,
      }))
    );
    setSubmitted(true);
    setStatus("pending");
    setConfirmOpen(false);
    try {
      await dbSubmit();
      const { toast } = await import("sonner");
      toast.success("Submitted for approval");
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(`Submit failed: ${(e as Error).message}`);
    }
    void dbUpdateRow; void dbRefetch;
  };

  const cycleStatus = () => {
    setStatus((s) =>
      s === "created" ? "pending" :
      s === "pending" ? "approved" :
      s === "approved" ? "rejected" :
      s === "rejected" ? "modification" : "created"
    );
  };

  const statusMeta = (s: typeof status) => {
    switch (s) {
      case "created": return { label: "Created", cls: "bg-sky-100 text-sky-800 ring-sky-300", dot: "bg-sky-500" };
      case "pending": return { label: "Pending for Approval", cls: "bg-yellow-100 text-yellow-800 ring-yellow-300", dot: "bg-yellow-500" };
      case "approved": return { label: "Approved", cls: "bg-green-100 text-green-800 ring-green-300", dot: "bg-green-500" };
      case "rejected": return { label: "Rejected", cls: "bg-red-100 text-red-800 ring-red-300", dot: "bg-red-500" };
      case "modification": return { label: "Modification Suggested", cls: "bg-indigo-100 text-indigo-800 ring-indigo-300", dot: "bg-indigo-500" };
      default: return { label: "Draft", cls: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground" };
    }
  };


  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">B</div>
          <div>
            <div className="text-sm font-semibold text-white">Bifrost 2.0</div>
            <div className="text-[11px] text-sidebar-foreground/70">Pricing Console</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-2 text-[13px]">
          {[
            { icon: LayoutDashboard, label: "Overview" },
            { icon: Tags, label: "Ecom Pricing", active: true },
            { icon: TrendingUp, label: "Demand Planning" },
            { icon: Package, label: "Procurement" },
            { icon: FileSpreadsheet, label: "Approvals" },
            { icon: Settings, label: "Settings" },
          ].map((it) => (
            <div
              key={it.label}
              className={`mb-0.5 flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 ${
                it.active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
              }`}
            >
              <it.icon className="h-4 w-4" />
              <span>{it.label}</span>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/60">
          v2.14.0 · Internal
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-card px-4">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Pricing</span>
            <span>/</span>
            <span className="text-foreground">Ecom Pricing</span>
            <span>/</span>
            <span>Price Upload</span>
          </div>
          <div className="flex items-center gap-3">
            {tab === 0 && sheetCreated && (
              <>
                <TableZoomControl value={tableZoom} onChange={setTableZoom} />
                <button
                  type="button"
                  onClick={() => setSheetFullscreen((f) => !f)}
                  className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted"
                  title={sheetFullscreen ? "Exit full screen (Esc)" : "Full screen pricing sheet"}
                >
                  {sheetFullscreen ? (
                    <Minimize2 className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Maximize2 className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </>
            )}
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">PR</div>
          </div>
        </header>

        <main className="flex-1 px-4 py-4">
          {/* Title + tabs */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Ecom Pricing</h1>
            <div className="text-[12px] text-muted-foreground">
              {city} · Delivery {deliveryDate}
            </div>
          </div>


          <div className="mb-4 flex flex-wrap gap-1 border-b">
            {TABS.map((t, i) => (
              <button
                key={t}
                onClick={() => setTab(i)}
                className={`relative px-3 py-2 text-[13px] font-medium ${
                  tab === i ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
                {tab === i && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
              </button>
            ))}
          </div>

          {tab === 0 && (
            <>
          {/* Filter row */}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delivery date</label>
              <input
                type="date"
                value={deliveryDate}
                max={maxDate}
                onChange={(e) => { setDeliveryDate(e.target.value); setSheetCreated(false); }}
                className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">City</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
              >
                {CITIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <button
              onClick={onCreateOrFetch}
              disabled={sheetExists === null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sheetExists === null ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> …</>
              ) : showCreate ? (
                <><Plus className="h-3.5 w-3.5" /> Create</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5" /> Fetch</>
              )}
            </button>
          </div>

          {sheetCreated && (<>
          {/* Action bar */}
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2 rounded-md border bg-card p-2">
            <div className="flex flex-wrap items-end gap-2">
              <button
                onClick={() => {
                  const header = "FSN ID,Weight Unit,NC SKU ID,NC SKU Name,Subcategory,Conv. Factor,Demand Units,Total Demand %,GRN ₹/kg,GRN ₹/unit,Prev Day GRN ₹/unit,GRN Diff,Blinkit SP,Adjusted GRN,Quoted PP,Negotiated PP,NLC,PI %,GM,Deflection %,Impact PP Diff,Impact GM,BK Value Mix\n";
                  const esc = (v: unknown) => {
                    const s = v === null || v === undefined ? "" : String(v);
                    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                  };
                  const body = sorted.map(({ row, calc }) =>
                    [row.fsnId, row.weightUnit, row.ncSkuId, row.ncSkuName, row.subcategory, row.conversionFactor,
                     row.demandUnits, calc.totalDemandPct?.toFixed(3), row.grnPricePerKg ?? "",
                     calc.grnPerUnit?.toFixed(2) ?? "", row.prevDayGrnPerUnit ?? "", calc.grnDiff?.toFixed(2) ?? "",
                     row.blinkitSp ?? "", row.adjustedGrn ?? 0, row.quotedPp, row.negotiatedPp,
                     calc.nlc.toFixed(2), calc.piPct?.toFixed(2) ?? "", calc.gm?.toFixed(2) ?? "",
                     row.priceDeflectionPct, calc.impactPpDiff?.toFixed(2) ?? "",
                     calc.impactGm?.toFixed(2) ?? "", calc.valueMix?.toFixed(0) ?? ""].map(esc).join(",")
                  ).join("\n");
                  const blob = new Blob([header + body], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `Pricing_${deliveryDate}_${city}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV
              </button>
              <button
                onClick={() => setBulkOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Upload className="h-3.5 w-3.5" /> Bulk Upload
              </button>
            </div>
            <div className="flex flex-col items-end gap-2">
              {status !== "draft" && (() => {
                const m = statusMeta(status);
                return (
                  <button
                    onClick={cycleStatus}
                    title="Click to cycle status (prototype)"
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${m.cls}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                    {m.label}
                  </button>
                );
              })()}
              <button
                onClick={onDownloadFkSheet}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" /> Download FK Sheet
              </button>
              <button
                disabled={submitDisabled}
                onClick={() => setConfirmOpen(true)}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit for Approval
              </button>
            </div>
          </div>

          <div
            className={
              sheetFullscreen
                ? "fixed inset-0 z-50 flex min-h-0 flex-col bg-background p-4"
                : ""
            }
          >
          {sheetFullscreen && (
            <div className="mb-2 flex shrink-0 items-center justify-between border-b pb-2">
              <span className="text-sm font-semibold">Price Upload — {city} · {deliveryDate}</span>
              <div className="flex items-center gap-3">
                <TableZoomControl value={tableZoom} onChange={setTableZoom} />
                <button
                  type="button"
                  onClick={() => setSheetFullscreen(false)}
                  className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted"
                  title="Exit full screen (Esc)"
                >
                  <Minimize2 className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Search + violation filter */}
          <div className="relative z-40 mb-2 flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search FSN ID, SKU name..."
                className="h-8 w-80 rounded-md border border-input bg-card pl-7 pr-2 text-[12px] outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setFilterOpen((o) => {
                  if (!o) setPendingViolationFilters(new Set(appliedViolationFilters));
                  return !o;
                })}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Filter</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {appliedViolationFilters.size === 0 ? "All SKUs" : `${appliedViolationFilters.size} selected`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {filterOpen && (
                <div className="absolute left-0 top-9 z-50 w-64 rounded-md border bg-card p-2 shadow-lg">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rule Violations</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingViolationFilters(new Set(VIOLATIONS.filter(v => v.key !== "all").map(v => v.key)))}
                        className="text-[11px] text-primary hover:underline"
                      >Select All</button>
                      <button
                        type="button"
                        onClick={() => setPendingViolationFilters(new Set())}
                        className="text-[11px] text-muted-foreground hover:underline"
                      >Clear</button>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    {VIOLATIONS.filter((v) => v.key !== "all").map((v) => {
                      const checked = pendingViolationFilters.has(v.key);
                      return (
                        <button
                          type="button"
                          key={v.key}
                          onClick={() => setPendingViolationFilters((s) => { const n = new Set(s); n.has(v.key) ? n.delete(v.key) : n.add(v.key); return n; })}
                          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                        >
                          <span className={`grid h-4 w-4 place-items-center rounded-sm border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}>
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          <span>{v.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={applyViolationFilters}
                      className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setSubcatFilterOpen((o) => {
                  if (!o) setPendingSubcategoryFilters(new Set(appliedSubcategoryFilters));
                  return !o;
                })}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Subcategory</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {appliedSubcategoryFilters.size === 0 ? "All" : `${appliedSubcategoryFilters.size} selected`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {subcatFilterOpen && (
                <div className="absolute left-0 top-9 z-50 flex max-h-72 w-64 flex-col rounded-md border bg-card p-2 shadow-lg">
                  <div className="mb-1 flex shrink-0 items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Subcategory</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingSubcategoryFilters(new Set(subcategoryOptions))}
                        className="text-[11px] text-primary hover:underline"
                      >Select All</button>
                      <button
                        type="button"
                        onClick={() => setPendingSubcategoryFilters(new Set())}
                        className="text-[11px] text-muted-foreground hover:underline"
                      >Clear</button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="flex flex-col">
                      {subcategoryOptions.length === 0 ? (
                        <span className="px-2 py-1.5 text-[12px] text-muted-foreground">No subcategories found</span>
                      ) : (
                        subcategoryOptions.map((name) => {
                          const checked = pendingSubcategoryFilters.has(name);
                          return (
                            <button
                              type="button"
                              key={name}
                              onClick={() => setPendingSubcategoryFilters((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; })}
                              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                            >
                              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}>
                                {checked && <Check className="h-3 w-3" />}
                              </span>
                              <span>{name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="mt-2 shrink-0 border-t pt-2">
                    <button
                      type="button"
                      onClick={applySubcategoryFilters}
                      className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {sorted.length} of {rows.length} SKUs
            </span>
          </div>

          {/* Table */}
          <div className={`rounded-md border bg-card ${sheetFullscreen ? "flex min-h-0 flex-1 flex-col" : ""}`}>
            <div
              className={`overflow-auto ${sheetFullscreen ? "min-h-0 flex-1" : "max-h-[calc(100vh-14rem)]"}`}
            >
            <div className="flex w-max min-w-full" style={{ zoom: tableZoom / 100 }}>
              {/* Frozen — immovable on horizontal scroll; width adjustable via edge handle */}
              <div
                className="relative sticky left-0 z-30 shrink-0 border-r-2 border-border bg-card"
                style={{ width: frozenPaneWidth }}
              >
                <FrozenTable
                  rows={sorted}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  toggleSort={toggleSort}
                  averages={averages}
                />
                <FrozenPaneResizeHandle
                  scale={tableZoom / 100}
                  onPointerDown={onFrozenResizeDown}
                  onPointerMove={onFrozenResizeMove}
                  onPointerUp={endFrozenResize}
                />
              </div>
              {/* Scrollable */}
              <div className="min-w-0 flex-1">
                <ScrollTable
                  rows={sorted}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  toggleSort={toggleSort}
                  averages={averages}
                  updateRowLocal={updateRowLocal}
                  persistRowFields={persistRowFields}
                  submitted={submitted}
                />
              </div>
            </div>
            </div>
          </div>

          <div className={`text-[11px] text-muted-foreground ${sheetFullscreen ? "mt-2 shrink-0" : "mt-2"}`}>
            Total demand {totalDemand.toLocaleString()} units
          </div>
          </div>
          </>)}
            </>
          )}

          {tab === 1 && (
            <PriceApprovalTab
              status={status}
              setStatus={setStatus}
              rejectionReason={rejectionReason}
              setRejectionReason={setRejectionReason}
              statusMeta={statusMeta}
              parentDate={deliveryDate}
              parentCity={city}
            />
          )}

          {tab === 2 && <UploadPanel kind="demand" />}
          {tab === 3 && <SkuConfigTab />}
          {tab === 4 && <GuardRailsTab />}
        </main>
      </div>


      {/* FAB */}
      {showFab && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-30 grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      {/* Bulk upload modal */}
      {bulkOpen && (
        <BulkUploadModal
          onClose={() => setBulkOpen(false)}
          onApply={async (updates) => {
            setBulkOpen(false);
            await runBulkApply(updates);
          }}
          failedCount={bulkFailuresVersion > -1 ? lastBulkFailures.current.length : 0}
          onRetryFailed={async () => {
            const failed = lastBulkFailures.current;
            if (failed.length === 0) return;
            setBulkOpen(false);
            await runBulkApply(failed);
          }}
        />
      )}

      {/* Confirm submit */}
      {confirmOpen && (
        <Modal onClose={() => setConfirmOpen(false)} title="Submit for approval?">
          <p className="text-[12px] text-muted-foreground">
            Lock all prices and submit for approval? This action cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmOpen(false)} className="h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted">Cancel</button>
            <button onClick={onConfirmSubmit} className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90">Confirm</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Modal ----------
function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Bulk Upload Modal ----------
type BulkUpdate = {
  fsnId: string;
  weightUnit: string | null;
  blinkitSp?: number | null;
  adjustedGrn?: number | null;
  quotedPp?: number | null;
  negotiatedPp?: number | null;
  grnPricePerKg?: number | null;
};
function BulkUploadModal({
  onClose,
  onApply,
  failedCount = 0,
  onRetryFailed,
}: {
  onClose: () => void;
  onApply: (updates: BulkUpdate[]) => void | Promise<void>;
  failedCount?: number;
  onRetryFailed?: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const updates: BulkUpdate[] = parsed
        .map((r) => {
          const getK = (...keys: string[]) => {
            for (const k of keys) {
              const found = Object.keys(r).find((h) => h.toLowerCase() === k.toLowerCase());
              if (found && r[found] !== "") return r[found];
            }
            return undefined;
          };
          const u: BulkUpdate = {
            fsnId: String(getK("fsn_id", "FSN ID", "FSNId") ?? ""),
            weightUnit: (getK("weight_unit", "Weight Unit", "WeightUnit") ?? null) as string | null,
          };
          const bk = getK("blinkit_sp", "Blinkit SP", "BlinkitSP");
          if (bk !== undefined) u.blinkitSp = toNum(bk);
          const adj = getK("adjusted_grn", "Adjusted GRN", "AdjustedGrn");
          if (adj !== undefined) u.adjustedGrn = toNum(adj);
          const qp = getK("quoted_pp", "Quoted PP", "QuotedPp");
          if (qp !== undefined) u.quotedPp = toNum(qp);
          const np = getK("negotiated_pp", "Negotiated PP", "NegotiatedPp");
          if (np !== undefined) u.negotiatedPp = toNum(np);
          const gk = getK("grn_price_per_kg", "GRN ₹/kg", "GRN Price Per Kg");
          if (gk !== undefined) u.grnPricePerKg = toNum(gk);
          return u;
        })
        .filter((u) =>
          u.fsnId &&
          (u.blinkitSp !== undefined || u.adjustedGrn !== undefined ||
           u.quotedPp !== undefined || u.negotiatedPp !== undefined ||
           u.grnPricePerKg !== undefined),
        );
      if (updates.length === 0) {
        const { toast } = await import("sonner");
        toast.error("No valid rows (need fsn_id + at least one editable column)");
        return;
      }
      await onApply(updates);
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(`Parse failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} title="Bulk upload prices">
      <p className="text-[12px] text-muted-foreground">
        Upload the exported sheet. Recognised editable columns: <code>blinkit_sp</code>,
        <code> adjusted_grn</code>, <code>quoted_pp</code>, <code>negotiated_pp</code>,
        <code> grn_price_per_kg</code>. Rows are matched on <code>fsn_id</code> +
        <code> weight_unit</code>, scoped to current city + delivery date. Any subset of columns is fine — others are left unchanged.
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mt-3 block w-full text-[12px]"
      />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {failedCount > 0 && onRetryFailed && (
          <button
            onClick={() => { void onRetryFailed(); }}
            className="mr-auto h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted"
            title="Re-run the rows that failed in the last upload"
          >
            Retry {failedCount} failed row{failedCount === 1 ? "" : "s"}
          </button>
        )}
        <button onClick={onClose} className="h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted">Cancel</button>
        <button
          onClick={submit}
          disabled={!file || busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
    </Modal>
  );
}



// ---------- Sub Category Metrics ----------
const SUBCATEGORY_LIST = [
  "Veg", "Exotic-Veg", "GGC", "Leaves", "Fruits-Domestic", "Fruits-Imported",
  "Premium", "Apple", "Mango", "Organic", "Banana", "VAP", "FK Vendor",
  "Onion", "Potato", "Grapes", "Tomato", "Stone Fruits", "T.Coconut",
  "Flowers", "Hydro", "Superplum", "Plant", "PL",
];

// Deterministic pseudo-random from string
function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function mockPiGm(name: string) {
  const h = hashSeed(name);
  const pi = 22 + (h % 800) / 100; // 22.00 - 29.99
  const gm = 6 + ((h >> 5) % 1200) / 100; // 6.00 - 17.99
  return { pi, gm };
}

function SubCategoryMetricsModal({
  enriched,
  overallPi,
  overallGm,
  onClose,
}: {
  enriched: { row: { subcategory: string; demandUnits: number }; calc: { piPct: number | null; gm: number | null } }[];
  overallPi: number | null;
  overallGm: number | null;
  onClose: () => void;
}) {
  // Aggregate real data per subcategory (demand-weighted where possible)
  const realAgg = new Map<string, { pi: number; gm: number }>();
  const buckets = new Map<string, { piNum: number; gmNum: number; piW: number; gmW: number }>();
  for (const e of enriched) {
    const key = e.row.subcategory;
    if (!buckets.has(key)) buckets.set(key, { piNum: 0, gmNum: 0, piW: 0, gmW: 0 });
    const b = buckets.get(key)!;
    const w = e.row.demandUnits || 1;
    if (e.calc.piPct !== null) { b.piNum += e.calc.piPct * w; b.piW += w; }
    if (e.calc.gm !== null) { b.gmNum += e.calc.gm * w; b.gmW += w; }
  }
  for (const [k, b] of buckets) {
    if (b.piW > 0 && b.gmW > 0) realAgg.set(k, { pi: b.piNum / b.piW, gm: b.gmNum / b.gmW });
  }

  const rows = SUBCATEGORY_LIST.map((name) => {
    const real = realAgg.get(name);
    const { pi, gm } = real ?? mockPiGm(name);
    return { name, pi, gm, isMock: !real };
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">View Metrics</h3>
          <p className="text-[11px] text-muted-foreground">Overall PI %, GM (₹) and sub category breakdown for the day.</p>
        </div>
        {/* Overall PI / GM summary */}
        <div className="grid grid-cols-2 gap-3 border-b bg-accent/30 px-4 py-3">
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Overall PI %</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {overallPi !== null ? `${overallPi.toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Overall GM (₹)</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {overallGm !== null ? `₹${overallGm.toFixed(2)}` : "—"}
            </div>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-muted text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Sub Category</th>
                <th className="px-4 py-2 text-right">PI %</th>
                <th className="px-4 py-2 text-right">GM (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.pi.toFixed(2)}%</td>
                  <td className="px-4 py-2 text-right tabular-nums">₹{r.gm.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}



// ---------- Frozen left table ----------
// Keep these in lockstep across FrozenTable + ScrollTable so split panes share one baseline.
// Group h-6 (24) + col h-9 (36) = 60 → sticky averages top offset.
const COL_HEAD_H = "h-9 max-h-9";
const SUB_HEAD_H = "h-7 max-h-7";
const ROW_H = "h-10 max-h-10";
const GROUP_HEAD_H = "h-6 max-h-6";
const HEAD_TH = "h-9 max-h-9 overflow-hidden py-0 align-middle";
const AVG_TD = "h-7 max-h-7 overflow-hidden py-0 align-middle";
const GROUP_TH = "h-6 max-h-6 overflow-hidden py-0 align-middle";
const STICKY_GROUP = "sticky top-0 z-20 bg-muted";
const STICKY_COL = "sticky top-6 z-20";
const STICKY_AVG = "sticky top-[60px] z-20";
const STICKY_FROZEN_GROUP = "sticky top-0 z-40";
const STICKY_FROZEN_COL = "sticky top-6 z-40";
const STICKY_FROZEN_AVG = "sticky top-[60px] z-40";

const FROZEN_PANE_DEFAULT = 350;
const FROZEN_PANE_MIN = 160;
const FROZEN_PANE_MAX = 720;
const APPROVAL_FROZEN_DEFAULT = 520;
const APPROVAL_FROZEN_MIN = 240;
const APPROVAL_FROZEN_MAX = 900;

function useResizableFrozenWidth(defaultWidth: number, minWidth: number, maxWidth: number) {
  const [width, setWidth] = useState(defaultWidth);
  const dragRef = useRef<{ startX: number; startW: number; scale: number } | null>(null);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, scale = 1) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: width, scale: scale || 1 };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.min(
        maxWidth,
        Math.max(minWidth, d.startW + (e.clientX - d.startX) / d.scale),
      );
      setWidth(next);
    },
    [minWidth, maxWidth],
  );

  const endResize = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return { width, onResizePointerDown, onResizePointerMove, endResize };
}

function FrozenPaneResizeHandle({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  scale = 1,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLElement>, scale?: number) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  scale?: number;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize frozen columns"
      title="Drag to resize frozen columns"
      className="group/fz absolute inset-y-0 right-0 z-40 w-2 translate-x-1/2 cursor-col-resize touch-none"
      onPointerDown={(e) => onPointerDown(e, scale)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="pointer-events-none mx-auto h-full w-0.5 bg-transparent transition-colors group-hover/fz:bg-primary group-active/fz:bg-primary" />
    </div>
  );
}

function GroupBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex h-6 items-center border-b bg-muted px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${className}`}>
      {children}
    </div>
  );
}

function FrozenTable({
  rows, sortKey, sortDir, toggleSort, averages,
}: {
  rows: Enriched[]; sortKey: string | null; sortDir: SortDir; toggleSort: (k: string) => void;
  averages: ReturnType<typeof computePriceUploadAverages>;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-[12px] [&_th]:box-border [&_td]:box-border [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:border-r [&_td]:border-r [&_th]:border-border/60 [&_td]:border-border/60 [&_tr>*:last-child]:border-r-0">
      <colgroup>
        <col style={{ width: "31%" }} /><col style={{ width: "38%" }} /><col style={{ width: "31%" }} />
      </colgroup>
      <thead>
        <tr className={GROUP_HEAD_H}>
          <th colSpan={2} title="Basic Information" className={`${STICKY_FROZEN_GROUP} ${GROUP_TH} truncate border-b bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Basic Information</th>
          <th colSpan={1} title="Demand Information" className={`${STICKY_FROZEN_GROUP} ${GROUP_TH} truncate border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Demand Information</th>
        </tr>
        <tr className={`${COL_HEAD_H} border-b`}>
          <th title="FSN ID" className={`${STICKY_FROZEN_COL} ${HEAD_TH} truncate bg-card px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>FSN ID</th>
          <th title="Weight Unit" className={`${STICKY_FROZEN_COL} ${HEAD_TH} truncate bg-card px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>Weight Unit</th>
          <th className={`${STICKY_FROZEN_COL} ${HEAD_TH} border-l bg-card px-2`}><SortHeader align="right" label="Total Demand %" active={sortKey==="totalDemandPct"} dir={sortDir} onClick={() => toggleSort("totalDemandPct")} /></th>
        </tr>
        <tr className={`${SUB_HEAD_H} border-b text-[11px] font-medium`}>
          <td colSpan={2} className={`${STICKY_FROZEN_AVG} ${AVG_TD} truncate bg-accent px-2 text-muted-foreground`}>Averages →</td>
          <td className={`${STICKY_FROZEN_AVG} ${AVG_TD} truncate border-l bg-accent px-2 text-right tabular-nums`}>{averages.totalDemandPct !== null ? `${averages.totalDemandPct.toFixed(3)}%` : "—"}</td>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ row, calc }) => {
          const negPi = calc.piPct !== null && calc.piPct < 0;
          const negGm = calc.gm !== null && calc.gm < 0;
          const highDefl = isDeflectionOutOfRange(row.priceDeflectionPct);
          const rowCls = negPi || negGm
            ? "border-l-4 border-l-red-500 bg-red-50/50"
            : highDefl
            ? "border-l-4 border-l-amber-500 bg-amber-50/50"
            : "";
          return (
            <tr key={row.fsnId} className={`${ROW_H} border-b last:border-b-0 hover:bg-muted/40 ${rowCls}`}>
              <td title={row.fsnId} className="truncate px-2 font-mono text-[11px] text-muted-foreground">{row.fsnId}</td>
              <td title={row.weightUnit} className="truncate px-2 text-muted-foreground">{row.weightUnit}</td>
              <td className="truncate border-l px-2 text-right tabular-nums">{calc.totalDemandPct.toFixed(3)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------- Scrollable right table ----------
function ScrollTable({
  rows, sortKey, sortDir, toggleSort, averages, updateRowLocal, persistRowFields, submitted,
}: {
  rows: Enriched[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (k: string) => void;
  averages: any;
  updateRowLocal: (id: string, p: Partial<SkuRow>) => void;
  persistRowFields: (id: string, weightUnit: string, p: Partial<SkuRow>) => void;
  submitted: boolean;
}) {
  return (
    <table className="min-w-[1850px] border-collapse text-[12px] [&_th]:box-border [&_td]:box-border [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:border-r [&_td]:border-r [&_th]:border-border/60 [&_td]:border-border/60 [&_tr>*:last-child]:border-r-0">
      <colgroup>
        {/* Basic Info (scrollable): NC SKU Name, Special Tags, Subcategory, Conv. Factor, Demand Units */}
        <col style={{ width: 200 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} />
        {/* Demand Info (6): NLC Value Mix, GRN/kg, Prev GRN/unit, GRN/unit, GRN Diff, Adjusted GRN */}
        <col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 120 }} />
        {/* Benchmark Info (12) */}
        <col style={{ width: 90 }} /><col style={{ width: 80 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} />
      </colgroup>
      <thead>
        <tr className={GROUP_HEAD_H}>
          <th colSpan={1} className={`${STICKY_GROUP} ${GROUP_TH} truncate border-b bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Basic Information</th>
          <th colSpan={3} className={`${STICKY_GROUP} ${GROUP_TH} truncate border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Basic Information (cont.)</th>
          <th colSpan={1} className={`${STICKY_GROUP} ${GROUP_TH} truncate border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Demand Information</th>
          <th colSpan={6} className={`${STICKY_GROUP} ${GROUP_TH} truncate border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Demand Information</th>
          <th colSpan={12} className={`${STICKY_GROUP} ${GROUP_TH} truncate border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}>Benchmark Information</th>
        </tr>

        <tr className={`${COL_HEAD_H} border-b`}>
          {/* Basic Info (scrollable) */}
          <th title="NC SKU Name" className={`${STICKY_COL} ${HEAD_TH} truncate bg-card px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>NC SKU Name</th>
          <th title="Special Tags" className={`${STICKY_COL} ${HEAD_TH} truncate border-l bg-card px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>Special Tags</th>
          <th title="Subcategory" className={`${STICKY_COL} ${HEAD_TH} truncate bg-card px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>Subcategory</th>
          <th title="Conv. Factor" className={`${STICKY_COL} ${HEAD_TH} truncate bg-card px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>Conv. Factor</th>
          <th className={`${STICKY_COL} ${HEAD_TH} border-l bg-card px-2`}><SortHeader align="right" label="Demand Units" active={sortKey==="demandUnits"} dir={sortDir} onClick={() => toggleSort("demandUnits")} /></th>
          {/* Demand Info */}
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="NLC Value Mix" active={sortKey==="nlcValueMix"} dir={sortDir} onClick={() => toggleSort("nlcValueMix")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="GRN ₹/kg" active={sortKey==="grnPricePerKg"} dir={sortDir} onClick={() => toggleSort("grnPricePerKg")} /></th>
          <th title="Prev Day GRN ₹/unit" className={`${STICKY_COL} ${HEAD_TH} bg-card px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}><Tip text="GRN ₹/unit on day T-n-1 (previous day). Read-only."><span className="block truncate">Prev Day GRN ₹/unit</span></Tip></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="GRN ₹/unit" active={sortKey==="grnPerUnit"} dir={sortDir} onClick={() => toggleSort("grnPerUnit")} /></th>
          <th title="GRN Diff" className={`${STICKY_COL} ${HEAD_TH} bg-card px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}><Tip text="(GRN ₹/unit + Adjusted GRN) − Prev Day GRN ₹/unit"><span className="block truncate">GRN Diff</span></Tip></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Adjusted GRN" active={sortKey==="adjustedGrn"} dir={sortDir} onClick={() => toggleSort("adjustedGrn")} /></th>
          {/* Benchmark Info */}
          <th className={`${STICKY_COL} ${HEAD_TH} border-l bg-card px-2`}><SortHeader align="right" label="Blinkit SP" active={sortKey==="blinkitSp"} dir={sortDir} onClick={() => toggleSort("blinkitSp")} /></th>
          <th title="WSP Trend" className={`${STICKY_COL} ${HEAD_TH} truncate bg-card px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>WSP Trend</th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Quoted PP" active={sortKey==="quotedPp"} dir={sortDir} onClick={() => toggleSort("quotedPp")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Negotiated PP" active={sortKey==="negotiatedPp"} dir={sortDir} onClick={() => toggleSort("negotiatedPp")} /></th>
          <th title="Suggested PP" className={`${STICKY_COL} ${HEAD_TH} truncate bg-card px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>Suggested PP</th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="NLC" active={sortKey==="nlc"} dir={sortDir} onClick={() => toggleSort("nlc")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="PI %" active={sortKey==="piPct"} dir={sortDir} onClick={() => toggleSort("piPct")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="GM" active={sortKey==="gm"} dir={sortDir} onClick={() => toggleSort("gm")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Deflection %" active={sortKey==="priceDeflectionPct"} dir={sortDir} onClick={() => toggleSort("priceDeflectionPct")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Impact PP Diff" active={sortKey==="impactPpDiff"} dir={sortDir} onClick={() => toggleSort("impactPpDiff")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="Impact GM" active={sortKey==="impactGm"} dir={sortDir} onClick={() => toggleSort("impactGm")} /></th>
          <th className={`${STICKY_COL} ${HEAD_TH} bg-card px-2`}><SortHeader align="right" label="BK Value Mix" active={sortKey==="valueMix"} dir={sortDir} onClick={() => toggleSort("valueMix")} /></th>
        </tr>
        {/* Averages */}
        <tr className={`${SUB_HEAD_H} border-b text-[11px] font-medium`}>
          <td colSpan={1} className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-muted-foreground`}>Averages →</td>
          <td colSpan={3} className={`${STICKY_AVG} ${AVG_TD} border-l bg-accent px-2 text-muted-foreground`}>Averages →</td>
          <td className={`${STICKY_AVG} ${AVG_TD} border-l bg-accent px-2 text-right tabular-nums`}>{averages.demandUnits !== null ? Math.round(averages.demandUnits).toLocaleString() : "—"}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{averages.nlcValueMix !== null ? `₹${Math.round(averages.nlcValueMix).toLocaleString()}` : "—"}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.grnPricePerKg)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.prevDayGrnPerUnit)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.grnPerUnit)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{averages.grnDiff !== null ? `${averages.grnDiff >= 0 ? "+" : ""}${averages.grnDiff.toFixed(2)}` : "—"}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{averages.adjustedGrn !== null ? `${averages.adjustedGrn >= 0 ? "+" : ""}${averages.adjustedGrn.toFixed(2)}` : "—"}</td>
          {/* Benchmark */}
          <td className={`${STICKY_AVG} ${AVG_TD} border-l bg-accent px-2 text-right tabular-nums`}>{fmt(averages.blinkitSp)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-center text-muted-foreground`}>—</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.quotedPp)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.negotiatedPp)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.suggestedPp)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.nlc)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{num(averages.piPct)}%</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.gm)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{num(averages.priceDeflectionPct)}%</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.impactPpDiff)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{fmt(averages.impactGm)}</td>
          <td className={`${STICKY_AVG} ${AVG_TD} bg-accent px-2 text-right tabular-nums`}>{averages.valueMix !== null ? `₹${Math.round(averages.valueMix).toLocaleString()}` : "—"}</td>
        </tr>
      </thead>


      <tbody>
        {rows.map(({ row, calc }) => {
          const suggestionPending =
            row.suggestedPp !== null &&
            (!row.negotiatedLocked || row.negotiatedPp === row.lastLockedNegotiated);
          return (
            <tr key={row.fsnId} className={`${ROW_H} border-b last:border-b-0 hover:bg-muted/40`}>
              {/* Basic Info (scrollable) */}
              <td className="max-w-[200px] truncate px-2 text-[11px]">{row.ncSkuName || "—"}</td>
              <td className="border-l px-2">
                {row.specialTag && (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row.specialTag === "Summer" ? "bg-warn-bg text-warn-foreground" :
                    row.specialTag === "Seasonal" ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"
                  }`}>{row.specialTag}</span>
                )}
              </td>
              <td className="px-2 text-muted-foreground">{row.subcategory}</td>
              <td className="px-2 text-right tabular-nums">{row.conversionFactor.toFixed(2)}</td>
              <td className="border-l px-2 text-right tabular-nums">{row.demandUnits.toLocaleString()}</td>
              {/* Demand Info */}
              <td className="px-2 text-right tabular-nums">₹{Math.round(calc.nlcValueMix).toLocaleString()}</td>

              {/* GRN ₹/kg — locked by default; click field to edit, lock to save */}
              <td className={`px-2 ${row.grnPricePerKg === null ? "bg-warn-bg/40" : ""}`}>
                <NullableLockedInput
                  value={row.grnPricePerKg}
                  locked={row.grnLocked ?? true}
                  disabled={submitted}
                  warn={row.grnPricePerKg === null}
                  onChange={(v) => updateRowLocal(row.fsnId, { grnPricePerKg: v })}
                  onUnlock={() => updateRowLocal(row.fsnId, { grnLocked: false })}
                  onToggleLock={() => {
                    if (row.grnLocked) {
                      updateRowLocal(row.fsnId, { grnLocked: false });
                    } else {
                      updateRowLocal(row.fsnId, { grnLocked: true });
                      persistRowFields(row.fsnId, row.weightUnit, { grnPricePerKg: row.grnPricePerKg });
                    }
                  }}
                />
              </td>
              {/* Prev Day GRN ₹/unit — read-only */}
              <td className="px-2 text-right tabular-nums text-muted-foreground">
                {calc.prevDayGrnPerUnit !== null ? fmt(calc.prevDayGrnPerUnit) : "-"}
              </td>
              {/* GRN ₹/unit */}
              <td className="px-2 text-right tabular-nums text-muted-foreground">
                {calc.grnPerUnit !== null ? fmt(calc.grnPerUnit) : "—"}
              </td>
              {/* GRN Difference */}
              <td className={`px-2 text-right tabular-nums ${calc.grnDiff !== null ? (calc.grnDiff > 0 ? "text-red-600" : calc.grnDiff < 0 ? "text-green-600" : "text-muted-foreground") : "text-muted-foreground"}`}>
                {calc.grnDiff !== null ? `${calc.grnDiff >= 0 ? "+" : ""}${calc.grnDiff.toFixed(2)}` : "-"}
              </td>
              {/* Adjusted GRN — signed, lockable. Applies to Quoted PP on lock. */}
              <td className="px-2">
                <AdjustedGrnInput
                  value={row.adjustedGrn ?? 0}
                  locked={row.adjustedGrnLocked ?? true}
                  disabled={submitted}
                  onChange={(v) => updateRowLocal(row.fsnId, { adjustedGrn: v })}
                  onUnlock={() => updateRowLocal(row.fsnId, { adjustedGrnLocked: false })}
                  onToggleLock={() => {
                    if (row.adjustedGrnLocked) {
                      updateRowLocal(row.fsnId, { adjustedGrnLocked: false });
                    } else {
                      const v = row.adjustedGrn ?? 0;
                      const patch: Partial<SkuRow> = { adjustedGrnLocked: true };
                      const persist: Partial<SkuRow> = { adjustedGrn: v };
                      if (v !== 0 && calc.grnPerUnit !== null) {
                        const newQ = calc.grnPerUnit + v;
                        patch.quotedPp = newQ;
                        patch.quotedTouched = true;
                        persist.quotedPp = newQ;
                        if (row.negotiatedLocked || !row.negotiatedTouched) {
                          patch.negotiatedPp = newQ;
                          patch.lastLockedNegotiated = newQ;
                          persist.negotiatedPp = newQ;
                        }
                      }
                      updateRowLocal(row.fsnId, patch);
                      persistRowFields(row.fsnId, row.weightUnit, persist);
                    }
                  }}
                />
              </td>

              {/* Benchmark Info */}
              {/* Blinkit SP — locked by default; click field to edit, lock to save */}
              <td className={`border-l px-2 ${row.blinkitSp === null ? "bg-warn-bg/40" : ""}`}>
                <NullableLockedInput
                  value={row.blinkitSp}
                  locked={row.blinkitLocked ?? true}
                  disabled={submitted}
                  warn={row.blinkitSp === null}
                  onChange={(v) => updateRowLocal(row.fsnId, { blinkitSp: v })}
                  onUnlock={() => updateRowLocal(row.fsnId, { blinkitLocked: false })}
                  onToggleLock={() => {
                    if (row.blinkitLocked) {
                      updateRowLocal(row.fsnId, { blinkitLocked: false });
                    } else {
                      updateRowLocal(row.fsnId, { blinkitLocked: true });
                      persistRowFields(row.fsnId, row.weightUnit, { blinkitSp: row.blinkitSp });
                    }
                  }}
                />
              </td>
              {/* WSP Trend */}
              <td className="px-2 text-center">
                {row.wspTrend === "up" ? (
                  <ArrowUp className="mx-auto h-4 w-4 text-emerald-600" aria-label="WSP up vs previous day" />
                ) : row.wspTrend === "down" ? (
                  <ArrowDown className="mx-auto h-4 w-4 text-red-600" aria-label="WSP down vs previous day" />
                ) : (
                  <span className="text-foreground" aria-label="WSP unchanged">–</span>
                )}
              </td>
              {/* Quoted PP */}
              <td className="px-2">
                <LockedPriceInput
                  value={row.quotedPp}
                  locked={row.quotedLocked}
                  disabled={submitted}
                  onChange={(v) => {
                    const next: Partial<SkuRow> = { quotedPp: v, quotedTouched: true };
                    setPartialIfNegotiatedFollows(next, row, v);
                    updateRowLocal(row.fsnId, next);
                  }}
                  onUnlock={() => updateRowLocal(row.fsnId, { quotedLocked: false })}
                  onToggleLock={() => {
                    if (!row.quotedLocked) {
                      updateRowLocal(row.fsnId, {
                        quotedLocked: true,
                        negotiatedPp: row.quotedPp,
                      });
                      persistRowFields(row.fsnId, row.weightUnit, {
                        quotedPp: row.quotedPp,
                        negotiatedPp: row.quotedPp,
                      });
                    } else {
                      updateRowLocal(row.fsnId, { quotedLocked: false });
                    }
                  }}
                />
              </td>
              {/* Negotiated PP */}
              <td className="px-2">
                <LockedPriceInput
                  value={row.negotiatedPp}
                  locked={row.negotiatedLocked}
                  disabled={submitted}
                  highlight={row.suggestedPp !== null && !row.negotiatedLocked}
                  onChange={(v) => updateRowLocal(row.fsnId, { negotiatedPp: v, negotiatedTouched: true })}
                  onUnlock={() => updateRowLocal(row.fsnId, { negotiatedLocked: false })}
                  onToggleLock={() => {
                    if (!row.negotiatedLocked) {
                      updateRowLocal(row.fsnId, {
                        negotiatedLocked: true,
                        lastLockedNegotiated: row.negotiatedPp,
                      });
                      persistRowFields(row.fsnId, row.weightUnit, { negotiatedPp: row.negotiatedPp });
                    } else {
                      updateRowLocal(row.fsnId, { negotiatedLocked: false });
                    }
                  }}
                />
                {suggestionPending && (
                  <span className="sr-only">Suggested ₹{row.suggestedPp} — update Negotiated PP to proceed</span>
                )}
              </td>
              {/* Suggested PP */}
              <td className={`px-2 text-right tabular-nums ${row.suggestedPp !== null ? "bg-suggest-bg text-suggest font-semibold" : "text-muted-foreground"}`}>
                {row.suggestedPp !== null ? fmt(row.suggestedPp) : "—"}
              </td>
              {/* NLC */}
              <td className="px-2 text-right tabular-nums">{fmt(calc.nlc)}</td>
              {/* PI % */}
              <td className={`px-2 text-right tabular-nums ${calc.piPct !== null && calc.piPct < 0 ? "bg-neg-bg text-neg font-semibold" : ""}`}>
                {calc.piPct !== null ? `${calc.piPct.toFixed(1)}%` : "—"}
              </td>
              {/* GM */}
              <td className={`px-2 text-right tabular-nums ${calc.gm !== null && calc.gm < 0 ? "bg-neg-bg text-neg font-semibold" : ""}`}>
                {calc.gm !== null ? fmt(calc.gm) : "—"}
              </td>
              {/* Deflection % */}
              <td className={`px-2 text-right tabular-nums ${isDeflectionOutOfRange(row.priceDeflectionPct) ? "bg-warn-bg text-warn-foreground font-semibold" : ""}`}>
                {row.priceDeflectionPct}%

              </td>
              {/* Impact PP Diff */}
              <td className="px-2 text-right tabular-nums">{calc.impactPpDiff !== null ? fmt(calc.impactPpDiff) : "—"}</td>
              {/* Impact GM */}
              <td className="px-2 text-right tabular-nums">{calc.impactGm !== null ? fmt(calc.impactGm) : "—"}</td>
              {/* BK Value Mix */}
              <td className="px-2 text-right tabular-nums">{calc.valueMix !== null ? `₹${Math.round(calc.valueMix).toLocaleString()}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function setPartialIfNegotiatedFollows(_patch: Partial<SkuRow>, _row: SkuRow, _v: number) {
  // placeholder: negotiated only syncs on lock per spec
}

function unlockOnEdit(
  locked: boolean,
  disabled: boolean | undefined,
  onUnlock: () => void,
) {
  return (e: ReactMouseEvent<HTMLInputElement>) => {
    if (locked && !disabled) {
      e.preventDefault();
      onUnlock();
      queueMicrotask(() => e.currentTarget.focus());
    }
  };
}

function LockedPriceInput({
  value, locked, disabled, highlight, onChange, onUnlock, onToggleLock,
}: {
  value: number;
  locked: boolean;
  disabled?: boolean;
  highlight?: boolean;
  onChange: (v: number) => void;
  onUnlock: () => void;
  onToggleLock: () => void;
}) {
  const lockBlocked = !locked && value < 1;
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        readOnly={locked}
        disabled={disabled}
        onMouseDown={unlockOnEdit(locked, disabled, onUnlock)}
        onChange={(e) => {
          if (locked) return;
          const raw = e.target.value;
          if (raw === "") { onChange(0); return; }
          const v = parseFloat(raw);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
        className={`h-7 w-20 rounded-sm border px-1 text-right text-[12px] tabular-nums outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground ${
          locked ? "cursor-pointer bg-muted/50 text-muted-foreground" : ""
        } ${highlight ? "border-suggest bg-suggest-bg/40" : "border-input bg-card"}`}
      />
      <button
        onClick={onToggleLock}
        disabled={disabled || lockBlocked}
        title={lockBlocked ? "Value must be ≥ 1 to lock" : locked ? "Unlock" : "Lock"}
        className={`grid h-6 w-6 place-items-center rounded-sm border ${
          locked ? "border-primary/30 bg-primary/10 text-primary" : "border-input bg-card text-muted-foreground hover:text-foreground"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
    </div>
  );
}

function NullableLockedInput({
  value, locked, disabled, warn, onChange, onUnlock, onToggleLock,
}: {
  value: number | null;
  locked: boolean;
  disabled?: boolean;
  warn?: boolean;
  onChange: (v: number | null) => void;
  onUnlock: () => void;
  onToggleLock: () => void;
}) {
  const lockBlocked = !locked && value !== null && value < 1;
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        value={value === null ? "" : value}
        placeholder="NA"
        readOnly={locked}
        disabled={disabled}
        onMouseDown={unlockOnEdit(locked, disabled, onUnlock)}
        onChange={(e) => {
          if (locked) return;
          const raw = e.target.value;
          if (raw === "") { onChange(null); return; }
          const v = parseFloat(raw);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
        className={`h-7 w-20 rounded-sm border px-1 text-right text-[12px] tabular-nums outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground ${
          locked ? "cursor-pointer bg-muted/50 text-muted-foreground" : ""
        } ${warn && value === null ? "border-warn bg-warn-bg/40" : "border-input bg-card"}`}
      />
      <button
        onClick={onToggleLock}
        disabled={disabled || lockBlocked}
        title={lockBlocked ? "Value must be ≥ 1 to lock" : locked ? "Unlock" : "Lock"}
        className={`grid h-6 w-6 place-items-center rounded-sm border ${
          locked ? "border-primary/30 bg-primary/10 text-primary" : "border-input bg-card text-muted-foreground hover:text-foreground"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
    </div>
  );
}


// Signed adjusted GRN input — default 0, allows negative/positive numbers. Requires lock to save.
function AdjustedGrnInput({
  value, locked, disabled, onChange, onUnlock, onToggleLock,
}: {
  value: number;
  locked: boolean;
  disabled?: boolean;
  onChange: (v: number) => void;
  onUnlock: () => void;
  onToggleLock: () => void;
}) {
  const nonZero = value !== 0;
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        readOnly={locked}
        disabled={disabled}
        onMouseDown={unlockOnEdit(locked, disabled, onUnlock)}
        onChange={(e) => {
          if (locked) return;
          const raw = e.target.value;
          if (raw === "" || raw === "-") { onChange(0); return; }
          const v = parseFloat(raw);
          if (Number.isFinite(v)) onChange(v);
        }}
        className={`h-7 w-20 rounded-sm border px-1 text-right text-[12px] tabular-nums outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground ${
          locked ? "cursor-pointer bg-muted/50 text-muted-foreground" : ""
        } ${nonZero ? "border-primary/50 bg-accent/30 font-semibold" : "border-input bg-card"}`}
      />
      <button
        onClick={onToggleLock}
        disabled={disabled}
        title={locked ? "Unlock" : "Lock"}
        className={`grid h-6 w-6 place-items-center rounded-sm border ${
          locked ? "border-primary/30 bg-primary/10 text-primary" : "border-input bg-card text-muted-foreground hover:text-foreground"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
    </div>
  );
}

// Inline NA-only editor: shows a small input that commits on Enter/blur.
function NaEditableInput({ disabled, onCommit }: { disabled?: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v >= 0) onCommit(v);
  };
  return (
    <input
      type="number"
      value={draft}
      placeholder="NA"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-7 w-20 rounded-sm border border-warn bg-warn-bg/40 px-1 text-right text-[12px] tabular-nums outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground"
    />
  );
}



// ---------- Upload Panel (Demand Upload / SKU Configuration) ----------
const UPLOAD_CITIES = ["Bengaluru", "Chennai", "Coimbatore", "Hyderabad", "Mumbai", "Nashik", "Trichy"];

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDDMMYYYY(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function UploadPanel({ kind }: { kind: "demand" | "sku" }) {
  const [date, setDate] = useState(tomorrowIso());
  const [city, setCity] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Demand upload: city comes from each CSV row, not from the dropdown.
  const canUpload = !!file && !uploading && (kind === "sku" ? !!city : !!date);

  const handleFiles = (files: FileList | null) => {
    if (!files || !files[0]) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".csv")) {
      import("sonner").then(({ toast }) => toast.error("Please select a CSV file"));
      return;
    }
    setFile(f);
  };

  const onUpload = async () => {
    if (!canUpload || !file) return;
    setUploading(true);
    const { toast } = await import("sonner");
    try {
      if (kind === "demand") {
        const text = await file.text();
        const parsed = parseCSV(text);
        // Map common demand CSV headers → pricing_sheet columns.
        const payload: Partial<PricingSheetRow>[] = parsed.map((r) => {
          const getK = (...keys: string[]) => {
            for (const k of keys) {
              const found = Object.keys(r).find((h) => h.toLowerCase() === k.toLowerCase());
              if (found) return r[found];
            }
            return undefined;
          };
          const ddRaw = getK("DeliveryDate", "delivery_date", "Delivery Date");
          const dd = ddRaw ? String(ddRaw).slice(0, 10) : date;
          const rowCity = getK("City", "city");
          return {
            delivery_date: dd,
            city: rowCity ? String(rowCity) : undefined,
            city_id: toInt(getK("cityid", "city_id", "CityId")),
            sku_id: (getK("SkuId", "sku_id", "NCSkuId", "nc_sku_id") ?? null) as string | null,
            fsn_id: (getK("FSN", "fsn_id", "FSNId", "FSN ID") ?? null) as string | null,
            sku_name: (getK("SKU", "sku_name", "SkuName", "NC SKU Name") ?? null) as string | null,
            weight_unit: (getK("weightunit", "weight_unit", "WeightUnit", "Weight Unit") ?? null) as string | null,
            cf: toNum(getK("CF", "cf", "ConversionFactor", "Conv. Factor")),
            bucket: (getK("bucket", "Bucket", "PointOfProcurement") ?? null) as string | null,
            subcategory: (getK("subcat", "subcategory", "Subcategory") ?? null) as string | null,
            demand_units: toNum(getK("orderedlot", "demand_units", "OrderedLot", "Demand Units")),
            demand_pct: toNum(getK("Mix", "demand_pct", "Total Demand %")),
            grn_price_per_kg: toNum(getK("T-1 GRN Qty", "GRN_Qty", "grn_price_per_kg", "GRN ₹/kg")),
            grn_price_per_unit: toNum(getK("T-1 GRN Unit", "GRN_Unit", "grn_price_per_unit", "GRN ₹/unit")),
            prev_grn_price_per_kg: toNum(getK("T-2 GRN Qty", "Prev_GRN_Qty", "prev_grn_price_per_kg")),
            prev_grn_price_per_unit: toNum(getK("T-2 GRN Unit", "Prev_GRN_Unit", "prev_grn_price_per_unit", "Prev Day GRN ₹/unit")),
            t3_grn_price_per_kg: toNum(getK("T-3 GRN Qty", "t3_grn_price_per_kg")),
            t3_grn_price_per_unit: toNum(getK("T-3 GRN Unit", "t3_grn_price_per_unit")),
          };
        }).filter((p) => p.delivery_date && p.city && p.sku_id);

        if (payload.length === 0) throw new Error("No valid rows found in CSV");

        const chunk = 500;
        let inserted = 0;
        for (let i = 0; i < payload.length; i += chunk) {
          const slice = payload.slice(i, i + chunk);
          const { error, count } = await supabase
            .from("pricing_sheet")
            .upsert(slice, { onConflict: "delivery_date,city,sku_id,weight_unit", count: "exact" });
          if (error) throw error;
          inserted += count ?? slice.length;
        }
        toast.success(`Demand uploaded — ${inserted} rows`);
      } else {
        toast.success("SKU configuration uploaded successfully");
      }
      setFile(null);
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const onDownloadSample = async () => {
    const { toast } = await import("sonner");
    toast.success("Sample file download started");
  };

  return (
    <div className="mx-auto max-w-5xl rounded-md border bg-card p-6">
      {/* Fields */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        {kind === "demand" && (
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-[12px] font-medium text-foreground">
              Delivery Date <span className="text-destructive">*</span>
            </label>
            <div
              onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.focus()}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-[13px] hover:border-primary"
            >
              <Calendar className="h-4 w-4 text-primary" />
              <span className="tabular-nums">{formatDDMMYYYY(date)}</span>
              <input
                ref={dateRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="sr-only"
              />
            </div>
          </div>
        )}
        {kind === "sku" && (
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-[12px] font-medium text-foreground">
              City <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-8 text-[13px] outline-none hover:border-primary focus:border-primary"
              >
                <option value="">Select City</option>
                {UPLOAD_CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
        )}
        {kind === "demand" && (
          <div className="min-w-[220px] flex-1 text-[12px] text-muted-foreground">
            City is read from each row of the uploaded CSV.
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50"
        }`}
      >
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-card">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <div className="text-[14px] text-foreground">
          {file ? file.name : "Drag and drop a file here or click to select"}
        </div>
        <div className="mt-1 text-[12px] text-primary underline">
          Please select a csv format file
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Upload button */}
      <button
        onClick={onUpload}
        disabled={!canUpload}
        style={{ backgroundColor: canUpload ? "#1a237e" : "#5c6bc0" }}
        className={`mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-md text-[14px] font-medium text-white transition-opacity ${
          canUpload ? "cursor-pointer hover:opacity-90" : "cursor-not-allowed"
        }`}
      >
        {uploading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" /> Upload
          </>
        )}
      </button>

      {/* Download sample */}
      <button
        onClick={onDownloadSample}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-card text-[14px] font-medium text-foreground hover:bg-muted"
      >
        <Download className="h-4 w-4" /> Download Sample File
      </button>
    </div>
  );
}

// ---------- SKU Configuration Tab ----------
type SkuConfigRow = {
  id: string;
  name: string;
  fsnId: string;
  ncSkuId: string;
  weight: number;
  weightUnitName: string;
  weightUnit: string;
  pmCost: number;
  fmlDump: number;
  processingCost: number;
  bkName: string;
  bkUom: string;
  skuTag: string;
};

const SKU_OPTIONS: SkuConfigRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: `SKU-${String(i + 1).padStart(3, "0")}`,
  name: [
    "Banana Robusta 1kg",
    "Tomato Hybrid 500g",
    "Onion Nasik 1kg",
    "Potato Jyoti 1kg",
    "Apple Shimla 1kg",
    "Carrot Ooty 500g",
    "Cucumber English 500g",
    "Ginger Fresh 250g",
    "Lemon Yellow 500g",
    "Coriander Bunch 100g",
  ][i],
  fsnId: `FSN20${String(i + 1).padStart(2, "0")}`,
  ncSkuId: [
    "NC-BAN-02", "NC-TOM-03", "NC-ONI-04", "NC-POT-05", "NC-APL-01",
    "NC-CAR-08", "NC-CUC-07", "NC-GIN-11", "NC-LEM-12", "NC-COR-13",
  ][i],
  weight: [1, 500, 1, 1, 1, 500, 500, 250, 500, 100][i],
  weightUnitName: ["Kilogram", "Gram", "Kilogram", "Kilogram", "Kilogram", "Gram", "Gram", "Gram", "Gram", "Gram"][i],
  weightUnit: ["Kg", "g", "Kg", "Kg", "Kg", "g", "g", "g", "g", "g"][i],
  pmCost: [42, 28, 35, 22, 145, 38, 30, 95, 48, 15][i],
  fmlDump: [3.5, 2.1, 4.0, 1.8, 6.2, 2.9, 2.5, 5.0, 3.2, 1.2][i],
  processingCost: [1.5, 1.0, 1.2, 0.8, 2.5, 1.1, 1.0, 2.2, 1.4, 0.6][i],
  bkName: [
    "Banana Robusta",
    "Tomato Local",
    "Onion Red",
    "Potato",
    "Apple Kashmir",
    "Carrot",
    "Cucumber",
    "Ginger",
    "Lemon",
    "Coriander",
  ][i],
  bkUom: ["1 kg", "500 g", "1 kg", "1 kg", "1 kg", "500 g", "500 g", "250 g", "500 g", "100 g"][i],
  skuTag: ["F&V", "F&V", "F&V", "F&V", "Premium", "F&V", "F&V", "Exotic", "F&V", "Herbs"][i],
}));

function SkuConfigTab() {
  const [city, setCity] = useState("");
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [skuOpen, setSkuOpen] = useState(false);
  const [skuQuery, setSkuQuery] = useState("");
  const [store, setStore] = useState<SkuConfigRow[]>(SKU_OPTIONS);
  const [fetched, setFetched] = useState<SkuConfigRow[]>([]);
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (skuRef.current && !skuRef.current.contains(e.target as Node)) setSkuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filteredOptions = store.filter(
    (o) => o.id.toLowerCase().includes(skuQuery.toLowerCase()) || o.name.toLowerCase().includes(skuQuery.toLowerCase())
  );
  const allSelected = selectedSkus.length === store.length;

  const toggleSku = (id: string) => {
    setFile(null);
    setSelectedSkus((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };
  const toggleAll = () => {
    setFile(null);
    setSelectedSkus(allSelected ? [] : store.map((o) => o.id));
  };

  const canFetch = selectedSkus.length > 0;

  const onFetch = () => {
    const rows = store.filter((o) => selectedSkus.includes(o.id));
    setFetched(rows);
    setPage(1);
  };

  const onChooseFile = () => fileRef.current?.click();
  const onFileChange = (files: FileList | null) => {
    if (!files || !files[0]) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".csv")) {
      import("sonner").then(({ toast }) => toast.error("Please select a CSV file"));
      return;
    }
    setFile(f);
  };

  const canUpload = !!file && !uploading;
  const onUpload = async () => {
    if (!canUpload || !file) return;
    setUploading(true);
    const text = await file.text();
    await new Promise((r) => setTimeout(r, 1500));
    // Parse CSV and merge changes by SKU ID
    try {
      const lines = text.split(/\r?\n/).filter(Boolean);
      const header = lines[0].split(",").map((h) => h.trim());
      const idx = (k: string) => header.findIndex((h) => h.toLowerCase() === k.toLowerCase());
      const iId = idx("SKU ID");
      const iPm = idx("Packaging Material Cost");
      const iFml = idx("FML + Dump");
      const iProc = idx("Processing Cost");
      const iBkN = idx("BK Name");
      const iBkU = idx("BK UOM");
      const iTag = idx("SKU Tag");
      const updates = new Map<string, Partial<SkuConfigRow>>();
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(",");
        const id = c[iId]?.trim();
        if (!id) continue;
        const patch: Partial<SkuConfigRow> = {};
        if (iPm >= 0) patch.pmCost = parseFloat(c[iPm]) || 0;
        if (iFml >= 0) patch.fmlDump = parseFloat(c[iFml]) || 0;
        if (iProc >= 0) patch.processingCost = parseFloat(c[iProc]) || 0;
        if (iBkN >= 0) patch.bkName = c[iBkN]?.trim() ?? "";
        if (iBkU >= 0) patch.bkUom = c[iBkU]?.trim() ?? "";
        if (iTag >= 0) patch.skuTag = c[iTag]?.trim() ?? "";
        updates.set(id, patch);
      }
      setStore((prev) => prev.map((r) => (updates.has(r.id) ? { ...r, ...updates.get(r.id)! } : r)));
      setFetched((prev) => prev.map((r) => (updates.has(r.id) ? { ...r, ...updates.get(r.id)! } : r)));
    } catch {
      /* ignore parse errors in prototype */
    }
    setUploading(false);
    const { toast } = await import("sonner");
    toast.success("Changes have been saved");
    setFile(null);
  };

  const canExport = fetched.length > 0;
  const onExport = async () => {
    if (!canExport) return;
    const header = "FSN ID,Weight (Weight Unit),NC SKU ID,SKU ID,SKU Name,Packaging Material Cost,FML + Dump,Processing Cost,BK Name,SKU Tag\n";
    const body = fetched
      .map((r) => `${r.fsnId},${r.weight} ${r.weightUnitName} (${r.weightUnit}),${r.ncSkuId},${r.id},${r.name},${r.pmCost},${r.fmlDump},${r.processingCost},${r.bkName},${r.skuTag}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sku-configuration.csv";
    a.click();
    URL.revokeObjectURL(url);
    const { toast } = await import("sonner");
    toast.success("Export downloaded");
  };

  const totalPages = Math.max(1, Math.ceil(fetched.length / 5));
  const pageRows = fetched.slice((page - 1) * 5, page * 5);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Fields row */}
      <div className="rounded-md border bg-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          {/* City */}
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-[12px] font-medium text-foreground">
              City <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-8 text-[13px] outline-none hover:border-primary focus:border-primary"
              >
                <option value="">Select City</option>
                {UPLOAD_CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {/* Search by SKU multi-select */}
          <div className="min-w-[280px] flex-[2]" ref={skuRef}>
            <label className="mb-1.5 block text-[12px] font-medium text-foreground">
              Search by SKU <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSkuOpen((o) => !o)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-[13px] hover:border-primary"
              >
                <span className="flex items-center gap-2 truncate">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  {selectedSkus.length > 0 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {selectedSkus.length} selected
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Search and select SKUs</span>
                  )}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              {skuOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg">
                  <div className="border-b p-2">
                    <input
                      autoFocus
                      value={skuQuery}
                      onChange={(e) => setSkuQuery(e.target.value)}
                      placeholder="Search SKUs..."
                      className="h-8 w-full rounded border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-[12px] hover:bg-muted">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    <span className="font-medium">All</span>
                  </label>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredOptions.length === 0 && (
                      <div className="px-3 py-3 text-center text-[12px] text-muted-foreground">No matches</div>
                    )}
                    {filteredOptions.map((o) => (
                      <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={selectedSkus.includes(o.id)}
                          onChange={() => toggleSku(o.id)}
                        />
                        <span className="font-mono">{o.id}</span>
                        <span className="text-muted-foreground">— {o.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Fetch button */}
          <button
            onClick={onFetch}
            disabled={!canFetch}
            style={{ backgroundColor: canFetch ? "#1a237e" : "#5c6bc0" }}
            className={`h-10 rounded-md px-5 text-[13px] font-medium text-white ${
              canFetch ? "cursor-pointer hover:opacity-90" : "cursor-not-allowed"
            }`}
          >
            Fetch
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onChooseFile}
            className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-[13px] font-medium text-foreground hover:bg-muted"
          >
            Choose File
          </button>
          {file && <span className="text-[12px] text-muted-foreground">{file.name}</span>}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFileChange(e.target.files)}
          />
          <button
            onClick={onUpload}
            disabled={!canUpload}
            style={{ backgroundColor: canUpload ? "#1a237e" : "#5c6bc0" }}
            className={`flex h-10 items-center gap-2 rounded-md px-5 text-[13px] font-medium text-white ${
              canUpload ? "cursor-pointer hover:opacity-90" : "cursor-not-allowed"
            }`}
          >
            {uploading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Upload
              </>
            )}
          </button>
          <button
            onClick={onExport}
            disabled={!canExport}
            className="ml-auto flex h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-[13px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {/* Results table */}
      {fetched.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">FSN ID</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Weight (Weight Unit)</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">NC SKU ID</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Packaging Material Cost (₹)</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">FML + Dump (₹)</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Processing Cost (₹)</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BK Name</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BK UOM</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SKU Tag</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.fsnId}</td>
                  <td className="px-3 py-2">{`${r.weight} ${r.weightUnitName} (${r.weightUnit})`}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.ncSkuId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{r.pmCost.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{r.fmlDump.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{r.processingCost.toFixed(2)}</td>
                  <td className="px-3 py-2">{r.bkName}</td>
                  <td className="px-3 py-2">{r.bkUom}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{r.skuTag}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-3 border-t px-4 py-2 text-[12px]">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border border-input px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded border border-input px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



// ============================================================
// Price Approval Tab
// ============================================================

type ApprovalRow = SkuRow & {
  approverSuggestedPp: number | null;
  approverSuggestedLocked: boolean;
  approverSuggestedTouched: boolean;
};

// Build approval seed with overrides for the required violation mix.
// 2 negative PI, 2 deflection>8, 1 negative GM, 1 with Suggested PP filled.
const APPROVAL_SEED: ApprovalRow[] = SEED.map((r) => {
  const base: ApprovalRow = {
    ...r,
    quotedLocked: true,
    negotiatedLocked: true,
    approverSuggestedPp: null,
    approverSuggestedLocked: true,
    approverSuggestedTouched: false,
  };
  // Force violations:
  // FSN1003 — already deflection 9.6 (high), make PI negative
  if (r.fsnId === "FSN1003") return { ...base, negotiatedPp: 38, quotedPp: 38, blinkitSp: 32, packagingCost: 4, fmlCost: 3, processingCost: 2 };
  // FSN1009 — already 11.4 deflection, force PI negative
  if (r.fsnId === "FSN1009") return { ...base, negotiatedPp: 34, quotedPp: 34, blinkitSp: 29 };
  // FSN1006 — already 8.7 deflection (kept)
  // FSN1004 — negative GM (grn missing → null gm). Replace with concrete neg GM
  if (r.fsnId === "FSN1004") return { ...base, grnPricePerKg: 48, quotedPp: 32, negotiatedPp: 32 };
  // FSN1005 — Suggested PP already filled by approver
  if (r.fsnId === "FSN1005") return { ...base, approverSuggestedPp: 25, approverSuggestedLocked: true, approverSuggestedTouched: true };
  return base;
});

function PriceApprovalTab({
  status, setStatus, rejectionReason, setRejectionReason, statusMeta, parentDate, parentCity,
}: {
  status: "draft" | "created" | "pending" | "approved" | "rejected" | "modification";
  setStatus: React.Dispatch<React.SetStateAction<"draft" | "created" | "pending" | "approved" | "rejected" | "modification">>;
  rejectionReason: string;
  setRejectionReason: (s: string) => void;
  statusMeta: (s: any) => { label: string; cls: string; dot: string };
  parentDate: string;
  parentCity: string;
}) {
  const [date, setDate] = useState(parentDate);
  const [city, setCity] = useState(parentCity);
  const [fetched, setFetched] = useState(false);
  const [rows, setRows] = useState<ApprovalRow[]>(APPROVAL_SEED);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [piMin, setPiMin] = useState(24);
  const [piMax, setPiMax] = useState(26);
  const [deflLimit, setDeflLimit] = useState(8);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [subCatOpen, setSubCatOpen] = useState(false);
  const [localReason, setLocalReason] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const {
    width: frozenPaneWidth,
    onResizePointerDown: onFrozenResizeDown,
    onResizePointerMove: onFrozenResizeMove,
    endResize: endFrozenResize,
  } = useResizableFrozenWidth(APPROVAL_FROZEN_DEFAULT, APPROVAL_FROZEN_MIN, APPROVAL_FROZEN_MAX);
  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };


  const canFetch = !!date && !!city;
  const isTomorrow = date === tomorrowISO();
  const isToday = date <= new Date().toISOString().slice(0, 10);
  // Pretend a sheet exists if tomorrow OR <= today (per spec). For demo, always exists.
  const sheetExists = canFetch && (isTomorrow || isToday);

  const totalDemand = useMemo(() => rows.reduce((s, r) => s + r.demandUnits, 0), [rows]);

  const enriched = useMemo(() =>
    rows.map((r) => {
      const effective = { ...r, piMixPct: r.blinkitSp === null ? 0 : r.piMixPct };
      return { row: effective, calc: deriveRow(effective, totalDemand) };
    }),
  [rows, totalDemand]);

  const violationOf = (e: { row: ApprovalRow; calc: ReturnType<typeof deriveRow> }) => {
    const pi = e.calc.piPct;
    const gm = e.calc.gm;
    const defl = e.row.priceDeflectionPct;
    const negPi = pi !== null && pi < 0;
    const negGm = gm !== null && gm < 0;
    const piOutOfRange = pi !== null && (pi < piMin || pi > piMax);
    const highDefl = isDeflectionOutOfRange(defl, -deflLimit, deflLimit);
    return { negPi, negGm, piOutOfRange, highDefl };
  };

  const counts = useMemo(() => {
    let negPi = 0, negGm = 0, highDefl = 0, piOut = 0;
    enriched.forEach((e) => {
      const v = violationOf(e);
      if (v.negPi) negPi++;
      if (v.negGm) negGm++;
      if (v.highDefl) highDefl++;
      if (v.piOutOfRange) piOut++;
    });
    return { negPi, negGm, highDefl, piOut };
  }, [enriched, piMin, piMax, deflLimit]);

  // basket-level overall PI and GM (demand-weighted by Blinkit SP)
  const overall = useMemo(() => {
    let revenue = 0, cost = 0, gmSum = 0, gmW = 0;
    enriched.forEach(({ row, calc }) => {
      if (row.blinkitSp !== null && calc.piPct !== null) {
        const w = row.demandUnits;
        revenue += row.blinkitSp * w;
        cost += calc.nlc * w;
      }
      if (calc.gm !== null) {
        gmSum += calc.gm * row.demandUnits;
        gmW += row.demandUnits;
      }
    });
    const overallPi = revenue ? ((revenue - cost) / revenue) * 100 : null;
    const overallGm = gmW ? gmSum / gmW : null;
    return { overallPi, overallGm };
  }, [enriched]);

  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return enriched;
    return enriched.filter((e) => {
      const v = violationOf(e);
      if (activeFilters.has("neg_pi") && v.negPi) return true;
      if (activeFilters.has("pi_range") && v.piOutOfRange) return true;
      if (activeFilters.has("neg_gm") && v.negGm) return true;
      if (activeFilters.has("defl") && v.highDefl) return true;
      return false;
    });
  }, [enriched, activeFilters, piMin, piMax, deflLimit]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const get = (e: typeof a): number | string => {
        switch (sortKey) {
          case "fsnId": return e.row.fsnId;
          case "ncSkuId": return e.row.ncSkuId;
          case "ncSkuName": return e.row.ncSkuName;
          case "weightUnit": return e.row.weightUnit;
          case "subcategory": return e.row.subcategory;
          case "totalDemandPct": return e.calc.totalDemandPct;
          case "grnPerUnit": return e.calc.grnPerUnit ?? -Infinity;
          case "blinkitSp": return e.row.blinkitSp ?? -Infinity;
          case "quotedPp": return e.row.quotedPp;
          case "negotiatedPp": return e.row.negotiatedPp;
          case "approverSuggestedPp": return e.row.approverSuggestedPp ?? -Infinity;
          case "nlc": return e.calc.nlc;
          case "piPct": return e.calc.piPct ?? -Infinity;
          case "gm": return e.calc.gm ?? -Infinity;
          case "priceDeflectionPct": return e.row.priceDeflectionPct;
          default: return 0;
        }
      };
      const va = get(a); const vb = get(b);
      if (typeof va === "string" || typeof vb === "string") {
        const cmp = String(va).localeCompare(String(vb));
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);


  const avgs = useMemo(() => {
    const valid = (arr: (number | null)[]) => arr.filter((x): x is number => x !== null);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
    const src = filtered;
    return {
      totalDemandPct: avg(src.map((e) => e.calc.totalDemandPct)),
      grnPerUnit: avg(valid(src.map((e) => e.calc.grnPerUnit))),
      blinkitSp: avg(valid(src.map((e) => e.row.blinkitSp))),
      quotedPp: avg(src.map((e) => e.row.quotedPp)),
      negotiatedPp: avg(src.map((e) => e.row.negotiatedPp)),
      suggestedPp: avg(valid(src.map((e) => e.row.approverSuggestedPp))),
      nlc: avg(src.map((e) => e.calc.nlc)),
      piPct: avg(valid(src.map((e) => e.calc.piPct))),
      gm: avg(valid(src.map((e) => e.calc.gm))),
      defl: avg(src.map((e) => e.row.priceDeflectionPct)),
    };
  }, [filtered]);

  const toggleFilter = (k: string) => {
    setActiveFilters((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const updateApproval = (id: string, patch: Partial<ApprovalRow>) =>
    setRows((rs) => rs.map((r) => (r.fsnId === id ? { ...r, ...patch } : r)));

  const anyUnlockedSuggestion = rows.some((r) => r.approverSuggestedTouched && !r.approverSuggestedLocked);
  const anySuggested = rows.some((r) => r.approverSuggestedPp !== null);
  const anyLockedSuggested = rows.some((r) => r.approverSuggestedPp !== null && r.approverSuggestedLocked);
  const sheetFinal = status === "approved" || status === "rejected";

  const canApprove = sheetExists && !sheetFinal && !anyUnlockedSuggestion && !anySuggested;
  const canReject = sheetExists && !sheetFinal && !anyUnlockedSuggestion && anySuggested;
  const canSuggest = sheetExists && !sheetFinal && !anyUnlockedSuggestion && anyLockedSuggested;

  // Empty state when no city or date
  if (!canFetch || !fetched) {
    return (
      <>
        <ApprovalFilters
          date={date} setDate={setDate} city={city} setCity={setCity}
          canFetch={canFetch} onFetch={() => setFetched(true)}
        />
        <div className="rounded-md border bg-card p-10 text-center text-[13px] text-muted-foreground">
          {canFetch ? "Click Fetch to load the pricing sheet." : "Select a delivery date and city to fetch a pricing sheet."}
        </div>
      </>
    );
  }

  if (!sheetExists) {
    return (
      <>
        <ApprovalFilters
          date={date} setDate={setDate} city={city} setCity={setCity}
          canFetch={canFetch} onFetch={() => setFetched(true)}
        />
        <div className="rounded-md border bg-card p-10 text-center text-[13px] text-muted-foreground">
          No pricing sheet found for the selected date and city.
        </div>
      </>
    );
  }

  const m = statusMeta(status === "draft" ? "pending" : status);

  return (
    <>
      <ApprovalFilters
        date={date} setDate={setDate} city={city} setCity={setCity}
        canFetch={canFetch} onFetch={() => setFetched(true)}
      />

      {/* View Metrics CTA */}
      <div className="mb-2 flex items-center gap-4">
        <button
          onClick={() => setSubCatOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          View Metrics
        </button>
      </div>

      {subCatOpen && (
        <SubCategoryMetricsModal
          enriched={enriched}
          overallPi={overall.overallPi}
          overallGm={overall.overallGm}
          onClose={() => setSubCatOpen(false)}
        />
      )}



      {/* Status badge (right) — above CTAs */}
      <div className="mb-6 flex items-center justify-end gap-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${m.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          {m.label}
        </span>
      </div>

      {/* Unlocked warning + CTAs */}
      {anyUnlockedSuggestion && !sheetFinal && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn-foreground">
          <AlertTriangle className="h-4 w-4" />
          Unlock edits detected — lock all suggested prices before taking action.
        </div>
      )}

      {!sheetFinal && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <ViolationFilterDropdown
            open={filterMenuOpen}
            setOpen={setFilterMenuOpen}
            active={activeFilters}
            setActive={setActiveFilters}
            counts={counts}
            deflLimit={deflLimit}
            configOpen={configOpen}
            setConfigOpen={setConfigOpen}
            piMin={piMin} setPiMin={setPiMin}
            piMax={piMax} setPiMax={setPiMax}
            deflLimitValue={deflLimit} setDeflLimit={setDeflLimit}
            overall={overall}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Tip text={!canApprove ? (anySuggested ? "Clear all suggested prices to approve" : "Lock all edited prices first") : ""}>
              <button
                disabled={!canApprove}
                onClick={() => setApproveOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-green-600 px-3 text-[12px] font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve
              </button>
            </Tip>
            <Tip text={!canReject ? "Add at least one suggested price to reject" : ""}>
              <button
                disabled={!canReject}
                onClick={() => setRejectOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-[12px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reject
              </button>
            </Tip>
            <Tip text={!canSuggest ? "Lock at least one suggested price" : ""}>
              <button
                disabled={!canSuggest}
                onClick={() => setSuggestOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Suggest Modifications
              </button>
            </Tip>
          </div>
        </div>
      )}


      {status === "rejected" && rejectionReason && (
        <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <span className="font-semibold">Rejection reason: </span>{rejectionReason}
        </div>
      )}


      {/* Table */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="flex">
          <div
            className="relative shrink-0 border-r-2 border-border bg-card"
            style={{ width: frozenPaneWidth }}
          >
            <ApprovalFrozenTable rows={sorted} violationOf={violationOf} averages={avgs} sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
            <FrozenPaneResizeHandle
              onPointerDown={onFrozenResizeDown}
              onPointerMove={onFrozenResizeMove}
              onPointerUp={endFrozenResize}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <ApprovalScrollTable
              rows={sorted}
              updateRow={updateApproval}
              readOnly={sheetFinal}
              averages={avgs}
              sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort}
            />
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Showing {sorted.length} of {rows.length} SKUs
      </div>


      {/* Approve modal */}
      {approveOpen && (
        <Modal onClose={() => setApproveOpen(false)} title="Approve pricing sheet?">
          <p className="text-[12px] text-muted-foreground">
            Approve this pricing sheet? Negotiated prices will be stored as Final Approved Prices. This action cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setApproveOpen(false)} className="h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted">Cancel</button>
            <button
              onClick={() => { setStatus("approved"); setApproveOpen(false); }}
              className="h-8 rounded-md bg-green-600 px-3 text-[12px] font-medium text-white hover:bg-green-700"
            >Approve</button>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {rejectOpen && (
        <Modal onClose={() => setRejectOpen(false)} title="Reject pricing sheet">
          <label className="mb-1 block text-[12px] font-medium">Rejection reason (required, min 10 chars)</label>
          <textarea
            value={localReason}
            onChange={(e) => setLocalReason(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-card p-2 text-[12px] outline-none focus:border-primary"
            placeholder="Explain why the sheet is being rejected..."
          />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setRejectOpen(false)} className="h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted">Cancel</button>
            <button
              disabled={localReason.trim().length < 10}
              onClick={() => { setRejectionReason(localReason.trim()); setStatus("rejected"); setRejectOpen(false); }}
              className="h-8 rounded-md bg-red-600 px-3 text-[12px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >Submit Rejection</button>
          </div>
        </Modal>
      )}

      {/* Suggest modal */}
      {suggestOpen && (
        <Modal onClose={() => setSuggestOpen(false)} title="Send suggested prices?">
          <p className="text-[12px] text-muted-foreground">
            Send suggested prices to pricing team for revision?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setSuggestOpen(false)} className="h-8 rounded-md border border-input px-3 text-[12px] hover:bg-muted">Cancel</button>
            <button
              onClick={() => { setStatus("modification"); setSuggestOpen(false); }}
              className="h-8 rounded-md bg-indigo-600 px-3 text-[12px] font-medium text-white hover:bg-indigo-700"
            >Send</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ApprovalFilters({
  date, setDate, city, setCity, canFetch, onFetch, statusBadge,
}: {
  date: string; setDate: (s: string) => void;
  city: string; setCity: (s: string) => void;
  canFetch: boolean; onFetch: () => void;
  statusBadge?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delivery date</label>
        <input
          type="date"
          value={date}
          max={tomorrowISO()}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">City</label>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
        >
          {CITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <button
        onClick={onFetch}
        disabled={!canFetch}
        className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Fetch
      </button>
      {statusBadge && <div className="ml-auto">{statusBadge}</div>}
    </div>
  );
}

function Chip({ label, danger, clickable, onClick }: { label: string; danger?: boolean; clickable?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 ${
        danger ? "bg-red-50 text-red-700 ring-red-300" : "bg-muted text-foreground ring-border"
      } ${clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
    >
      {label}
    </button>
  );
}

function ViolationFilterDropdown({
  open, setOpen, active, setActive, counts, deflLimit,
  configOpen, setConfigOpen, piMin, setPiMin, piMax, setPiMax,
  deflLimitValue, setDeflLimit, overall,
}: {
  open: boolean; setOpen: (b: boolean) => void;
  active: Set<string>; setActive: React.Dispatch<React.SetStateAction<Set<string>>>;
  counts: { negPi: number; negGm: number; highDefl: number; piOut: number };
  deflLimit: number;
  configOpen: boolean; setConfigOpen: (b: boolean | ((o: boolean) => boolean)) => void;
  piMin: number; setPiMin: (n: number) => void;
  piMax: number; setPiMax: (n: number) => void;
  deflLimitValue: number; setDeflLimit: (n: number) => void;
  overall: { overallPi: number | null; overallGm: number | null };
}) {
  const OPTIONS = [
    { key: "neg_pi", label: "Negative PI", count: counts.negPi },
    { key: "pi_range", label: "PI Out of Range", count: counts.piOut },
    { key: "neg_gm", label: "GM Negative", count: counts.negGm },
    { key: "defl", label: `Deflection outside ±${deflLimit}%`, count: counts.highDefl },
  ];
  const toggle = (k: string) => {
    setActive((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };
  const selectAll = () => setActive(new Set(OPTIONS.map((o) => o.key)));
  const clearAll = () => setActive(new Set());
  const summary = active.size === 0
    ? "All SKUs"
    : active.size === OPTIONS.length
    ? "All violations"
    : `${active.size} filter${active.size > 1 ? "s" : ""}`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-[12px] font-medium hover:bg-muted"
        >
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Filter</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute left-0 top-9 z-30 w-72 rounded-md border bg-card p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rule Violations</span>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-[11px] text-primary hover:underline">Select All</button>
                <button onClick={clearAll} className="text-[11px] text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <div className="flex flex-col">
              {OPTIONS.map((o) => {
                const checked = active.has(o.key);
                return (
                  <button
                    key={o.key}
                    onClick={() => toggle(o.key)}
                    className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <span className={`grid h-4 w-4 place-items-center rounded-sm border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}>
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      {o.label}
                    </span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{o.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-end border-t pt-2">
              <button onClick={() => setOpen(false)} className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90">Done</button>
            </div>
          </div>
        )}
      </div>


    </div>
  );
}
// (Violation Config panel removed per design)

function ApprovalFrozenTable({
  rows, violationOf, averages, sortKey, sortDir, toggleSort,
}: {
  rows: { row: ApprovalRow; calc: ReturnType<typeof deriveRow> }[];
  violationOf: (e: { row: ApprovalRow; calc: ReturnType<typeof deriveRow> }) => { negPi: boolean; negGm: boolean; piOutOfRange: boolean; highDefl: boolean };
  averages: { totalDemandPct: number | null };
  sortKey: string | null; sortDir: SortDir; toggleSort: (k: string) => void;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-[12px] [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:border-r [&_td]:border-r [&_th]:border-border/60 [&_td]:border-border/60 [&_th]:align-middle [&_td]:align-middle [&_tr>*:last-child]:border-r-0">
      <colgroup>
        <col style={{ width: "14%" }} />
        <col style={{ width: "40%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "14%" }} />
      </colgroup>


      <thead className="sticky top-0 z-10 bg-card">
        <tr>
          <th colSpan={4} title="SKU Info" className="h-6 truncate border-b bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">SKU Info</th>
          <th colSpan={1} title="Demand" className="h-6 truncate border-b bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Demand</th>
        </tr>
        <tr className={`${COL_HEAD_H} border-b bg-card`}>
          <th className="overflow-hidden px-2"><SortHeader label="FSN ID" active={sortKey==="fsnId"} dir={sortDir} onClick={() => toggleSort("fsnId")} /></th>
          <th className="overflow-hidden px-2"><SortHeader label="Weight Unit" active={sortKey==="weightUnit"} dir={sortDir} onClick={() => toggleSort("weightUnit")} /></th>
          <th className="overflow-hidden px-2"><SortHeader label="NC SKU ID" active={sortKey==="ncSkuId"} dir={sortDir} onClick={() => toggleSort("ncSkuId")} /></th>
          <th className="overflow-hidden px-2"><SortHeader label="Subcategory" active={sortKey==="subcategory"} dir={sortDir} onClick={() => toggleSort("subcategory")} /></th>
          <th className="overflow-hidden px-2"><SortHeader align="right" label="Demand %" active={sortKey==="totalDemandPct"} dir={sortDir} onClick={() => toggleSort("totalDemandPct")} /></th>
        </tr>
        <tr className={`${SUB_HEAD_H} border-b bg-accent/30 text-[11px] font-medium`}>
          <td colSpan={4} className="truncate px-2 text-muted-foreground">Averages →</td>
          <td className="truncate px-2 text-right tabular-nums">{averages.totalDemandPct !== null ? `${averages.totalDemandPct.toFixed(3)}%` : "—"}</td>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const { row, calc } = e;
          const v = violationOf(e);
          const rowCls = v.negPi || v.negGm
            ? "border-l-4 border-l-red-500 bg-red-50/50"
            : v.highDefl || v.piOutOfRange
            ? "border-l-4 border-l-amber-500 bg-amber-50/50"
            : "";
          return (
            <tr key={row.fsnId} className={`${ROW_H} border-b last:border-b-0 hover:bg-muted/40 ${rowCls}`}>
              <td className="truncate px-2 font-mono text-[11px] text-muted-foreground">{row.fsnId}</td>
              <td className="truncate px-2 text-muted-foreground">{row.weightUnit}</td>
              <td className="truncate px-2 font-mono text-[11px]">{row.ncSkuId}</td>
              <td className="truncate px-2 text-muted-foreground">{row.subcategory}</td>


              <td className="px-2 text-right tabular-nums">{calc.totalDemandPct.toFixed(3)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ApprovalScrollTable({
  rows, updateRow, readOnly, averages, sortKey, sortDir, toggleSort,
}: {
  rows: { row: ApprovalRow; calc: ReturnType<typeof deriveRow> }[];
  updateRow: (id: string, patch: Partial<ApprovalRow>) => void;
  readOnly: boolean;
  averages: {
    grnPerUnit: number | null; blinkitSp: number | null;
    quotedPp: number | null; negotiatedPp: number | null; suggestedPp: number | null;
    nlc: number | null; piPct: number | null; gm: number | null; defl: number | null;
  };
  sortKey: string | null; sortDir: SortDir; toggleSort: (k: string) => void;
}) {
  return (
    <table className="min-w-[1200px] border-collapse text-[12px] [&_th]:border-r [&_td]:border-r [&_th]:border-border/60 [&_td]:border-border/60 [&_th]:align-middle [&_td]:align-middle [&_tr>*:last-child]:border-r-0">
      <colgroup>
        <col style={{ width: 100 }} />
        <col style={{ width: 100 }} />
        <col style={{ width: 100 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 140 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 110 }} />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-card">
        <tr>
          <th colSpan={3} className="h-6 border-b bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Procurement / Benchmark</th>
          <th colSpan={3} className="h-6 border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pricing</th>
          <th colSpan={4} className="h-6 border-b border-l bg-muted px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Metrics</th>
        </tr>
        <tr className={`${COL_HEAD_H} border-b bg-card`}>
          <th className="px-2"><SortHeader align="right" label="GRN ₹/unit" active={sortKey==="grnPerUnit"} dir={sortDir} onClick={() => toggleSort("grnPerUnit")} /></th>
          <th className="px-2"><SortHeader align="right" label="Adjusted GRN" active={sortKey==="adjustedGrn"} dir={sortDir} onClick={() => toggleSort("adjustedGrn")} /></th>
          <th className="px-2"><SortHeader align="right" label="Blinkit SP" active={sortKey==="blinkitSp"} dir={sortDir} onClick={() => toggleSort("blinkitSp")} /></th>
          <th className="border-l px-2"><SortHeader align="right" label="Quoted PP" active={sortKey==="quotedPp"} dir={sortDir} onClick={() => toggleSort("quotedPp")} /></th>
          <th className="px-2"><SortHeader align="right" label="Negotiated PP" active={sortKey==="negotiatedPp"} dir={sortDir} onClick={() => toggleSort("negotiatedPp")} /></th>
          <th className="px-2"><SortHeader align="right" label="Suggested PP" active={sortKey==="approverSuggestedPp"} dir={sortDir} onClick={() => toggleSort("approverSuggestedPp")} /></th>
          <th className="border-l px-2"><SortHeader align="right" label="NLC" active={sortKey==="nlc"} dir={sortDir} onClick={() => toggleSort("nlc")} /></th>
          <th className="px-2"><SortHeader align="right" label="PI %" active={sortKey==="piPct"} dir={sortDir} onClick={() => toggleSort("piPct")} /></th>
          <th className="px-2"><SortHeader align="right" label="GM" active={sortKey==="gm"} dir={sortDir} onClick={() => toggleSort("gm")} /></th>
          <th className="px-2"><SortHeader align="right" label="Deflection %" active={sortKey==="priceDeflectionPct"} dir={sortDir} onClick={() => toggleSort("priceDeflectionPct")} /></th>
        </tr>
        <tr className={`${SUB_HEAD_H} border-b bg-accent/30 text-[11px] font-medium`}>
          <td className="px-2 text-right tabular-nums">{fmt(averages.grnPerUnit)}</td>
          <td className="px-2 text-right tabular-nums text-muted-foreground">—</td>
          <td className="px-2 text-right tabular-nums">{fmt(averages.blinkitSp)}</td>
          <td className="border-l px-2 text-right tabular-nums">{fmt(averages.quotedPp)}</td>
          <td className="px-2 text-right tabular-nums">{fmt(averages.negotiatedPp)}</td>
          <td className="px-2 text-right tabular-nums">{fmt(averages.suggestedPp)}</td>
          <td className="border-l px-2 text-right tabular-nums">{fmt(averages.nlc)}</td>
          <td className="px-2 text-right tabular-nums">{num(averages.piPct)}%</td>
          <td className="px-2 text-right tabular-nums">{fmt(averages.gm)}</td>
          <td className="px-2 text-right tabular-nums">{num(averages.defl)}%</td>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const { row, calc } = e;
          const negDiffers = row.negotiatedPp !== row.quotedPp;
          return (
            <tr key={row.fsnId} className={`${ROW_H} border-b last:border-b-0 hover:bg-muted/40`}>
              <td className="px-2 text-right tabular-nums">{calc.grnPerUnit !== null ? fmt(calc.grnPerUnit) : "—"}</td>
              <td className="px-2 text-right tabular-nums">{row.adjustedGrn && row.adjustedGrn !== 0 ? `${row.adjustedGrn > 0 ? "+" : ""}${row.adjustedGrn.toFixed(2)}` : "—"}</td>
              <td className="px-2 text-right tabular-nums">{row.blinkitSp !== null ? fmt(row.blinkitSp) : "—"}</td>
              <td className="border-l px-2 text-right tabular-nums">{fmt(row.quotedPp)}</td>
              <td className={`px-2 text-right tabular-nums font-medium ${negDiffers ? "bg-amber-100 text-amber-900" : ""}`}
                  title={negDiffers ? `Changed from quoted ₹${row.quotedPp}` : ""}>
                {fmt(row.negotiatedPp)}
                {negDiffers && <span className="ml-1 text-[10px] font-normal text-amber-700">Δ</span>}
              </td>
              <td className="px-2">
                <SuggestedInput
                  value={row.approverSuggestedPp}
                  locked={row.approverSuggestedLocked}
                  disabled={readOnly}
                  onChange={(v2) => updateRow(row.fsnId, { approverSuggestedPp: v2, approverSuggestedTouched: true, approverSuggestedLocked: false })}
                  onClear={() => updateRow(row.fsnId, { approverSuggestedPp: null, approverSuggestedTouched: false, approverSuggestedLocked: true })}
                  onToggleLock={() => {
                    if (row.approverSuggestedLocked) {
                      updateRow(row.fsnId, { approverSuggestedLocked: false });
                    } else {
                      updateRow(row.fsnId, { approverSuggestedLocked: true });
                    }
                  }}
                />
              </td>
              <td className="border-l px-2 text-right tabular-nums">{fmt(calc.nlc)}</td>
              <td className="px-2 text-right tabular-nums">
                {calc.piPct !== null ? `${calc.piPct.toFixed(1)}%` : "—"}
              </td>
              <td className="px-2 text-right tabular-nums">
                {calc.gm !== null ? fmt(calc.gm) : "—"}
              </td>
              <td className={`px-2 text-right tabular-nums ${isDeflectionOutOfRange(row.priceDeflectionPct) ? "bg-warn-bg text-warn-foreground font-semibold" : ""}`}>
                {row.priceDeflectionPct}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


function SuggestedInput({
  value, locked, disabled, onChange, onClear, onToggleLock,
}: {
  value: number | null;
  locked: boolean;
  disabled?: boolean;
  onChange: (v: number) => void;
  onClear: () => void;
  onToggleLock: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        value={value ?? ""}
        placeholder="—"
        disabled={(locked && value !== null) || disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
          else onClear();
        }}
        className={`h-7 w-20 rounded-sm border px-1 text-right text-[12px] tabular-nums outline-none focus:border-primary disabled:bg-muted disabled:text-muted-foreground ${
          value !== null ? "border-suggest bg-suggest-bg/40" : "border-input bg-card"
        }`}
      />

      <button
        onClick={onToggleLock}
        disabled={disabled || value === null}
        title={locked ? "Unlock" : "Lock"}
        className={`grid h-6 w-6 place-items-center rounded-sm border ${
          locked && value !== null ? "border-primary/30 bg-primary/10 text-primary" : "border-input bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
        }`}
      >
        {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
    </div>
  );
}


// ---------- Guardrails Tab ----------
const GR_CITIES = ["Bengaluru", "Chennai", "Coimbatore", "Hyderabad", "Mumbai", "Nashik", "Trichy"];

function GuardRailsTab() {
  const [city, setCity] = useState("Bengaluru");
  const [mode, setMode] = useState<"idle" | "view" | "edit">("idle");
  const { guardrails, save: saveGuardrails } = useGuardrails(city);
  const [rails, setRails] = useState({ piMin: 24, piMax: 26, gm: 6.05, defl: 8 });

  useEffect(() => {
    setRails({
      piMin: guardrails.pi_min ?? 24,
      piMax: guardrails.pi_max ?? 26,
      gm: guardrails.gm_target ?? 6.05,
      defl: Math.abs(guardrails.deflection_target ?? 8),
    });
  }, [guardrails]);

  const [form, setForm] = useState<{ piMin: number | ""; piMax: number | ""; gm: number | ""; defl: number | "" }>(rails);
  const [confirm, setConfirm] = useState(false);
  // Prototype role switch: simulate restricted-access user who can see Update.
  const [role, setRole] = useState<"user" | "admin">("user");

  const labelCls = "text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground";
  const inputCls =
    "h-9 rounded-[7px] border border-[#dde1ea] bg-white px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary";

  const onFetch = () => setMode("view");
  const onUpdate = () => {
    setForm(rails);
    setMode("edit");
  };

  const isValid = (["piMin", "piMax", "gm", "defl"] as const).every((k) => {
    const v = form[k];
    return typeof v === "number" && v > 0;
  });

  const onSaveClick = () => {
    if (!isValid) {
      import("sonner").then(({ toast }) => toast.error("Values must be greater than 0"));
      return;
    }
    setConfirm(true);
  };
  const onSaveConfirm = async () => {
    const next = form as typeof rails;
    setRails(next);
    setConfirm(false);
    setMode("view");
    const { toast } = await import("sonner");
    try {
      await saveGuardrails({
        pi_min: next.piMin,
        pi_max: next.piMax,
        gm_target: next.gm,
        deflection_target: Math.abs(next.defl),
      });
      toast.success("Saved Successfully");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  };

  const numInput = (key: "piMin" | "piMax" | "gm" | "defl", extra = "", step?: string) => {
    const v = form[key];
    const invalid = v === "" || (typeof v === "number" && v <= 0);
    return (
      <input
        type="number"
        step={step}
        value={v}
        onChange={(e) => {
          const raw = e.target.value;
          setForm({ ...form, [key]: raw === "" ? "" : Number(raw) });
        }}
        className={inputCls + " " + extra + (invalid ? " border-red-400 focus:ring-red-400" : "")}
      />
    );
  };

  return (
    <div className="max-w-3xl">
      <div className="rounded-lg border border-[#dde1ea] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Guardrails</h2>
          </div>

          {/* Prototype role toggle */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="uppercase tracking-[0.06em] text-muted-foreground">View as</span>
            <div className="inline-flex overflow-hidden rounded-[7px] border border-[#dde1ea]">
              <button
                onClick={() => { setRole("user"); if (mode === "edit") setMode("view"); }}
                className={"px-2 py-1 text-[11px] " + (role === "user" ? "bg-[#1a237e] text-white" : "bg-white text-foreground")}
              >
                User
              </button>
              <button
                onClick={() => setRole("admin")}
                className={"px-2 py-1 text-[11px] " + (role === "admin" ? "bg-[#1a237e] text-white" : "bg-white text-foreground")}
              >
                Admin
              </button>
            </div>
          </div>
        </div>

        {/* Section 1: City + Fetch + (Update for admins only) */}
        <div className="flex flex-wrap items-end gap-3 border-b border-[#eef0f5] pb-5">
          <div className="min-w-[200px]">
            <label className={labelCls + " mb-1 block"}>City</label>
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setMode("idle");
              }}
              className={inputCls + " w-full"}
            >
              {GR_CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <button
            onClick={onFetch}
            className="h-9 rounded-[7px] border border-primary bg-white px-4 text-[13px] font-medium text-primary hover:bg-primary/5"
          >
            Fetch
          </button>
          {role === "admin" && (
            <button
              onClick={onUpdate}
              className="h-9 rounded-[7px] px-4 text-[13px] font-medium text-white"
              style={{ background: "#1a237e", borderColor: "#1a237e" }}
            >
              Update
            </button>
          )}
        </div>

        {/* State B: read-only display */}
        {mode === "view" && (
          <div className="pt-5">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Guardrails · {city}
            </div>
            <div className="divide-y divide-[#eef0f5] rounded-[7px] border border-[#dde1ea]">
              <RailRow label="Purchase Index" value={`${rails.piMin}% – ${rails.piMax}%`} />
              <RailRow label="Gross Margin" value={`${rails.gm}%`} />
              <RailRow label="Deflection %" value={`± ${rails.defl}%`} />
            </div>
          </div>
        )}

        {/* State C: editable form */}
        {mode === "edit" && (
          <div className="pt-5">
            <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Guardrails · {city}
            </div>
            <div className="space-y-5">
              {/* Purchase Index */}
              <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                <div className={labelCls}>Purchase Index</div>
                <div className="flex items-center gap-3">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Min</div>
                    <div className="relative">
                      {numInput("piMin", "w-28 pr-7")}
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Max</div>
                    <div className="relative">
                      {numInput("piMax", "w-28 pr-7")}
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Gross Margin */}
              <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                <div className={labelCls}>Gross Margin</div>
                <div className="relative w-28">
                  {numInput("gm", "w-full pr-7", "0.01")}
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-muted-foreground">%</span>
                </div>
              </div>

              {/* Deflection */}
              <div className="grid grid-cols-[180px_1fr] items-start gap-4">
                <div className={labelCls + " pt-2"}>Deflection %</div>
                <div>
                  <div className="relative w-36">
                    <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[12px] text-muted-foreground">±</span>
                    {numInput("defl", "w-full pl-7 pr-7")}
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-muted-foreground">%</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Applies as +value and −value</div>
                </div>
              </div>
            </div>

            {!isValid && (
              <div className="mt-4 text-[11px] text-red-600">All values must be greater than 0.</div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={onSaveClick}
                disabled={!isValid}
                className="h-9 rounded-[7px] px-5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "#1a237e" }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>


      {/* Save Confirm Modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-[#dde1ea] bg-white p-6 shadow-xl">
            <div className="text-[14px] font-medium text-foreground">Do you want to save changes?</div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(false)}
                className="h-9 rounded-[7px] border border-primary bg-white px-4 text-[13px] font-medium text-primary hover:bg-primary/5"
              >
                Cancel
              </button>
              <button
                onClick={onSaveConfirm}
                className="h-9 rounded-[7px] px-4 text-[13px] font-medium text-white"
                style={{ background: "#1a237e" }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-semibold" style={{ color: "#1a237e" }}>{value}</span>
    </div>
  );
}
