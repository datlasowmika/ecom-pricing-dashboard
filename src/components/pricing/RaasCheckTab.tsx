import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { fetchPriceSheetDetails, fetchPriceSheetHeader, mergeHeaderAndDetails } from "@/lib/priceSheetDb";
import { downloadCSV, parseCSVMatrix, toCSV } from "@/lib/csv";
import { enrichRowsWithMysqlWeightUnits, loadFsnWeightUnitLookup } from "@/lib/fsnWeightUnit";

const CITIES = ["Bengaluru", "Chennai", "Coimbatore", "Hyderabad", "Mumbai", "Nashik", "Trichy"];
const PAGE_SIZE = 50;

/** Excel-style columns: B = index 1, R = index 17 */
const RAAS_FSN_COL = 1; // Column B
const RAAS_PRICE_COL = 17; // Column R
const RAAS_MIN_COLS = RAAS_PRICE_COL + 1;

const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Strip currency symbols / commas / whitespace and parse a price. Blank → null. */
export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .trim()
    .replace(/^(rs\.?|inr|₹|\$)\s*/i, "")
    .replace(/\s*(rs\.?|inr|₹|\$)$/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (s === "" || s === "-" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Money equality to the nearest paise (2 decimal places). */
function pricesEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Status when the FSN exists in both the pricing sheet and the RAAS file.
 * - price match: Negotiated PP = RAAS price (both present and equal)
 * - Price Mismatch: both prices present for the same FSN but numerically different
 */
function statusWhenFsnInBoth(
  negotiatedPp: number,
  raasFinalPrice: number | null,
): "price match" | "Price Mismatch" {
  if (raasFinalPrice === null) {
    return "Price Mismatch";
  }
  return pricesEqual(negotiatedPp, raasFinalPrice) ? "price match" : "Price Mismatch";
}

export type RaasStatus =
  | "price match"
  | "Price Mismatch"
  | "FSN not found in RAAS file"
  | "FSN not found in pricing sheet";

const STATUS_OPTIONS: RaasStatus[] = [
  "price match",
  "Price Mismatch",
  "FSN not found in RAAS file",
  "FSN not found in pricing sheet",
];

type ToolSku = {
  fsnId: string;
  weightUnit: string;
  negotiatedPp: number;
};

/** Same effective Negotiated PP as Price Upload (`dbToSku`). */
function effectiveNegotiatedPp(row: {
  negotiated_pp: number | null;
  quoted_pp: number | null;
}): number {
  return row.negotiated_pp ?? row.quoted_pp ?? 0;
}

/** Normalize FSN for matching only (display keeps original string). */
function fsnKey(fsn: string) {
  return fsn.trim().toUpperCase();
}

async function fetchToolSkusFromDb(city: string, deliveryDate: string): Promise<ToolSku[]> {
  const header = await fetchPriceSheetHeader(city, deliveryDate);
  if (!header) return [];
  const details = await fetchPriceSheetDetails(header.price_sheet_id);
  const rows = mergeHeaderAndDetails(header, details);
  const enriched = await enrichRowsWithMysqlWeightUnits(rows, city);
  return mapToolSkus(enriched);
}

/**
 * FSN → Weight Unit from vormir/asgard MySQL (with join fallbacks).
 */
async function fetchWeightUnitLookup(fsnIds: string[], city: string) {
  const unique = Array.from(
    new Set(fsnIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (unique.length === 0) {
    return {
      weightUnits: new Map<string, string>(),
      notInMapping: [] as string[],
      unresolved: [] as string[],
    };
  }

  const result = await loadFsnWeightUnitLookup(unique, city);
  return {
    weightUnits: new Map(Object.entries(result.weightUnits)),
    notInMapping: result.notInMapping,
    unresolved: result.unresolved,
  };
}

type RaasRow = {
  fsnId: string;
  finalPrice: number | null;
  sourceIndex: number;
};

export type RaasCompareRow = {
  key: string;
  fsnId: string;
  weightUnit: string;
  negotiatedPp: number | null;
  raasFinalPrice: number | null;
  difference: number | null;
  status: RaasStatus;
  inTool: boolean;
  inRaas: boolean;
};

type StatusFilter = "all" | RaasStatus;

function buildComparison(
  tool: ToolSku[],
  raas: RaasRow[],
  weightUnitByFsn: Map<string, string> = new Map(),
): RaasCompareRow[] {
  // First RAAS price per FSN (duplicates: keep first occurrence).
  // Map key = normalized FSN; value keeps the original RAAS FSN string for display.
  const raasByFsn = new Map<string, { displayFsn: string; finalPrice: number | null }>();
  for (const r of raas) {
    const key = fsnKey(r.fsnId);
    if (!key || raasByFsn.has(key)) continue;
    raasByFsn.set(key, { displayFsn: r.fsnId.trim(), finalPrice: r.finalPrice });
  }

  const toolFsns = new Set(tool.map((t) => fsnKey(t.fsnId)));
  const rows: RaasCompareRow[] = [];

  for (const t of tool) {
    const key = fsnKey(t.fsnId);
    const weightUnit = (t.weightUnit || weightUnitByFsn.get(key) || "").trim();
    const raasHit = raasByFsn.get(key);
    if (raasHit) {
      // FSN in pricing sheet AND in RAAS file → price match or Price Mismatch.
      const raasFinalPrice = raasHit.finalPrice;
      const difference =
        raasFinalPrice !== null ? raasFinalPrice - t.negotiatedPp : null;
      rows.push({
        key: `${t.fsnId}::${weightUnit}::tool`,
        fsnId: t.fsnId,
        weightUnit,
        negotiatedPp: t.negotiatedPp,
        raasFinalPrice,
        difference,
        status: statusWhenFsnInBoth(t.negotiatedPp, raasFinalPrice),
        inTool: true,
        inRaas: true,
      });
    } else {
      // FSN in pricing sheet, not in RAAS file.
      rows.push({
        key: `${t.fsnId}::${weightUnit}::tool-only`,
        fsnId: t.fsnId,
        weightUnit,
        negotiatedPp: t.negotiatedPp,
        raasFinalPrice: null,
        difference: null,
        status: "FSN not found in RAAS file",
        inTool: true,
        inRaas: false,
      });
    }
  }

  for (const [key, { displayFsn, finalPrice: raasFinalPrice }] of raasByFsn) {
    if (toolFsns.has(key)) continue;
    // FSN in RAAS file, not in current pricing sheet — show RAAS FSN + looked-up Weight Unit.
    const weightUnit = weightUnitByFsn.get(key) ?? "";
    rows.push({
      key: `${displayFsn}::raas-only`,
      fsnId: displayFsn,
      weightUnit,
      negotiatedPp: null,
      raasFinalPrice,
      difference: null,
      status: "FSN not found in pricing sheet",
      inTool: false,
      inRaas: true,
    });
  }

  const statusOrder: Record<RaasStatus, number> = {
    "Price Mismatch": 0,
    "price match": 1,
    "FSN not found in RAAS file": 2,
    "FSN not found in pricing sheet": 3,
  };
  rows.sort((a, b) => {
    const d = statusOrder[a.status] - statusOrder[b.status];
    if (d !== 0) return d;
    return a.fsnId.localeCompare(b.fsnId) || a.weightUnit.localeCompare(b.weightUnit);
  });
  return rows;
}

function mapToolSkus(
  rows: {
    fsn_id: string | null;
    weight_unit: string | null;
    negotiated_pp: number | null;
    quoted_pp: number | null;
  }[],
): ToolSku[] {
  const out: ToolSku[] = [];
  for (const r of rows) {
    const fsnId = (r.fsn_id ?? "").trim();
    if (!fsnId) continue;
    out.push({
      fsnId,
      weightUnit: (r.weight_unit ?? "").trim(),
      negotiatedPp: effectiveNegotiatedPp(r),
    });
  }
  return out;
}

function parseRaasFile(text: string): { rows: RaasRow[]; error: string | null } {
  const matrix = parseCSVMatrix(text);
  if (matrix.length < 2) {
    return { rows: [], error: "The file is empty or has no data rows." };
  }

  // Skip header row; read Column B (FSN) and Column R (RAAS Price) by position.
  const dataRows = matrix.slice(1);
  const tooNarrow = dataRows.find((r) => r.length < RAAS_MIN_COLS);
  if (tooNarrow) {
    return {
      rows: [],
      error: `Invalid RAAS file format. Expected at least ${RAAS_MIN_COLS} columns (A–R). Column B = FSN ID, Column R = RAAS Price. Found ${tooNarrow.length} column(s) on a data row.`,
    };
  }

  const draft: RaasRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const fsnId = (row[RAAS_FSN_COL] ?? "").trim();
    if (!fsnId) continue;
    const rawPrice = row[RAAS_PRICE_COL] ?? "";
    draft.push({
      fsnId,
      finalPrice: parsePrice(rawPrice),
      sourceIndex: i,
    });
  }

  if (draft.length === 0) {
    return { rows: [], error: "No valid FSN ID rows found in Column B of the RAAS file." };
  }

  return { rows: draft, error: null };
}

function buildSampleRaasCsv(): string {
  const headers = Array.from({ length: RAAS_MIN_COLS }, (_, i) => {
    if (i === RAAS_FSN_COL) return "FSN ID";
    if (i === RAAS_PRICE_COL) return "RAAS Price";
    return `Col${String.fromCharCode(65 + i)}`;
  });
  const row1 = Array.from({ length: RAAS_MIN_COLS }, () => "");
  row1[RAAS_FSN_COL] = "FFWFX4NYFXEXAMPLE1";
  row1[RAAS_PRICE_COL] = "120.50";
  const row2 = Array.from({ length: RAAS_MIN_COLS }, () => "");
  row2[RAAS_FSN_COL] = "FFWFX4NYFXEXAMPLE2";
  row2[RAAS_PRICE_COL] = "85";
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, row1, row2].map((r) => r.map(esc).join(",")).join("\n");
}

const fmtPrice = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `₹${n.toFixed(2)}`;

const fmtDiff = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
};

function statusBadgeClass(status: RaasStatus) {
  switch (status) {
    case "price match":
      return "bg-green-50 text-green-800 ring-green-200";
    case "Price Mismatch":
      return "bg-red-50 text-red-800 ring-red-200";
    case "FSN not found in RAAS file":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "FSN not found in pricing sheet":
      return "bg-sky-50 text-sky-900 ring-sky-200";
  }
}

function rowHighlightClass(status: RaasStatus) {
  switch (status) {
    case "price match":
      return "bg-green-50/30";
    case "Price Mismatch":
      return "bg-red-50/40";
    case "FSN not found in RAAS file":
      return "bg-amber-50/30";
    case "FSN not found in pricing sheet":
      return "bg-sky-50/30";
    default:
      return "";
  }
}

export function RaasCheckTab({
  parentDate,
  parentCity,
}: {
  parentDate?: string;
  parentCity?: string;
}) {
  const [date, setDate] = useState(parentDate || tomorrowISO());
  const [city, setCity] = useState(parentCity || "Bengaluru");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toolSkus, setToolSkus] = useState<ToolSku[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [compareRows, setCompareRows] = useState<RaasCompareRow[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  /** "stage" = drop-zone pick only; "process" = Upload button → run comparison */
  const pickModeRef = useRef<"stage" | "process">("stage");
  const toolSkusRef = useRef(toolSkus);
  toolSkusRef.current = toolSkus;

  const canSelect = !!date && !!city;
  const sheetReady = toolSkus !== null && toolSkus.length > 0;
  const sheetMissing = toolSkus !== null && toolSkus.length === 0 && !sheetLoading;

  const loadSheet = useCallback(async (d: string, c: string) => {
    if (!d || !c) {
      setToolSkus(null);
      return;
    }
    setSheetLoading(true);
    setSheetError(null);
    setToolSkus(null);
    setCompareRows(null);
    setFileName(null);
    setPendingFile(null);
    setUploadError(null);
    setStatusFilter("all");
    setFilterOpen(false);
    setPage(1);
    try {
      const skus = await fetchToolSkusFromDb(c, d);
      setToolSkus(skus);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Failed to load pricing sheet");
      setToolSkus([]);
    } finally {
      setSheetLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canSelect) return;
    void loadSheet(date, city);
  }, [date, city, canSelect, loadSheet]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filterOpen]);

  const onDateOrCityChange = (nextDate: string, nextCity: string) => {
    setDate(nextDate);
    setCity(nextCity);
  };

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    if (!canSelect) {
      setUploadError("Select a delivery date and city first.");
      return;
    }
    setUploadError(null);
    setCompareRows(null);
    setFileName(null);
    setComparing(true);
    try {
      // Re-fetch pricing sheet so Negotiated PP matches latest Price Upload data.
      const skus = await fetchToolSkusFromDb(city, date);
      if (skus.length === 0) {
        setUploadError("No pricing data found for this date/city.");
        setPendingFile(null);
        return;
      }
      setToolSkus(skus);
      toolSkusRef.current = skus;

      const text = await file.text();
      const { rows, error } = parseRaasFile(text);
      if (error) {
        setUploadError(error);
        setPendingFile(null);
        return;
      }
      setPendingFile(null);
      setFileName(file.name);

      // Look up MySQL weight units for blank tool rows + all RAAS FSNs.
      const toolKeys = new Set(skus.map((s) => fsnKey(s.fsnId)));
      const needLookup = Array.from(
        new Set([
          ...skus.filter((s) => !s.weightUnit.trim()).map((s) => s.fsnId),
          ...rows.map((r) => r.fsnId).filter((id) => !toolKeys.has(fsnKey(id))),
          ...rows.map((r) => r.fsnId),
        ]),
      );
      const lookup = await fetchWeightUnitLookup(needLookup, city);

      setCompareRows(buildComparison(skus, rows, lookup.weightUnits));
      setStatusFilter("all");
      setPage(1);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to read the uploaded file.");
      setPendingFile(null);
    } finally {
      setComparing(false);
    }
  };

  const stageFile = (file: File | null) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && file.type !== "text/csv" && file.type !== "application/vnd.ms-excel") {
      setUploadError("Please select a CSV format file.");
      return;
    }
    setUploadError(null);
    setPendingFile(file);
  };

  const openPicker = (mode: "stage" | "process") => {
    pickModeRef.current = mode;
    fileInputRef.current?.click();
  };

  const onUploadClick = () => {
    if (pendingFile) {
      void onFileSelected(pendingFile);
      return;
    }
    openPicker("process");
  };

  const onDownloadSample = () => {
    downloadCSV("RAAS_Sample.csv", buildSampleRaasCsv());
  };

  const clearUpload = () => {
    setCompareRows(null);
    setFileName(null);
    setPendingFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const filtered = useMemo(() => {
    if (!compareRows) return [];
    if (statusFilter === "all") return compareRows;
    return compareRows.filter((r) => r.status === statusFilter);
  }, [compareRows, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: 0,
      "price match": 0,
      "Price Mismatch": 0,
      "FSN not found in RAAS file": 0,
      "FSN not found in pricing sheet": 0,
    };
    if (!compareRows) return base;
    base.all = compareRows.length;
    for (const r of compareRows) base[r.status]++;
    return base;
  }, [compareRows]);

  const filterLabel =
    statusFilter === "all" ? "All statuses" : statusFilter;

  const onDownload = () => {
    if (filtered.length === 0) return;
    const csv = toCSV(
      filtered.map((r) => ({
        "FSN ID": r.fsnId,
        "Weight Unit": r.weightUnit.trim() || "NO weight unit",
        "Negotiated PP": r.inTool ? (r.negotiatedPp ?? "") : "",
        "RAAS Final Price": r.inRaas ? (r.raasFinalPrice ?? "") : "",
        Difference: r.difference ?? "",
        "Mismatch Status": r.status,
      })),
      ["FSN ID", "Weight Unit", "Negotiated PP", "RAAS Final Price", "Difference", "Mismatch Status"],
    );
    const safe = statusFilter === "all" ? "All" : statusFilter.replace(/\s+/g, "_");
    downloadCSV(`RAAS_Check_${date}_${city}_${safe}.csv`, csv);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Delivery date
          </label>
          <input
            type="date"
            value={date}
            max={tomorrowISO()}
            onChange={(e) => onDateOrCityChange(e.target.value, city)}
            className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            City
          </label>
          <select
            value={city}
            onChange={(e) => onDateOrCityChange(date, e.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void loadSheet(date, city)}
          disabled={!canSelect || sheetLoading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sheetLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {sheetLoading && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-primary/20 bg-card px-4 py-5 shadow-sm">
          <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-[13px] font-medium text-foreground">Loading pricing sheet…</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Looking up {city} · {date}
            </p>
          </div>
        </div>
      )}

      {comparing && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-primary/20 bg-card px-4 py-5 shadow-sm">
          <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-[13px] font-medium text-foreground">Processing RAAS file…</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Comparing prices and resolving weight units — this can take a moment.
            </p>
          </div>
        </div>
      )}

      {sheetError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{sheetError}</span>
        </div>
      )}

      {sheetMissing && !sheetError && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-amber-900">
            No pricing data found for this date/city
          </p>
          <p className="mt-1 text-[12px] text-amber-800/80">
            Create or fetch a pricing sheet in Price Upload for {city} on {date} before running a RAAS check.
          </p>
        </div>
      )}

      {sheetReady && !comparing && (
        <div className="mb-3 rounded-lg border bg-card p-6 shadow-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              const mode = pickModeRef.current;
              pickModeRef.current = "stage";
              e.target.value = "";
              if (!file) return;
              if (mode === "process") {
                void onFileSelected(file);
              } else {
                stageFile(file);
              }
            }}
          />
          <button
            type="button"
            onClick={() => openPicker("stage")}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              stageFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/50"
            }`}
          >
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-sky-100 text-sky-600">
              <Upload className="h-6 w-6" />
            </span>
            <p className="text-[14px] text-muted-foreground">Please upload RAAS file in CSV format</p>
            <p className="mt-2 text-[15px] font-medium text-primary">
              Please select a file or drag and drop here
            </p>
          </button>

          {(pendingFile || fileName) && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="truncate text-[12px] text-foreground">
                {pendingFile?.name ?? fileName}
                {pendingFile ? (
                  <span className="ml-2 text-muted-foreground">(ready to upload)</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={clearUpload}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
                title="Clear file"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onDownloadSample}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-4 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              Download Sample
            </button>
            <button
              type="button"
              onClick={onUploadClick}
              disabled={comparing}
              className="inline-flex h-9 min-w-[7.5rem] items-center justify-center gap-2 rounded-md bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {comparing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                "Upload"
              )}
            </button>
          </div>
        </div>
      )}

      {uploadError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {compareRows && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="relative" ref={filterRef}>
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-[12px] font-medium hover:bg-muted"
              >
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Filter</span>
                <span className="max-w-[220px] truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {filterLabel}
                  {statusFilter !== "all" ? ` (${counts[statusFilter]})` : ` (${counts.all})`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {filterOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-md border bg-card p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("all");
                      setFilterOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                  >
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-sm border ${
                        statusFilter === "all"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-card"
                      }`}
                    >
                      {statusFilter === "all" && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1">All statuses</span>
                    <span className="text-[11px] text-muted-foreground">{counts.all}</span>
                  </button>
                  <div className="my-1 border-t" />
                  {STATUS_OPTIONS.map((opt) => {
                    const checked = statusFilter === opt;
                    return (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => {
                          setStatusFilter(opt);
                          setFilterOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                      >
                        <span
                          className={`grid h-4 w-4 place-items-center rounded-sm border ${
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-card"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1">{opt}</span>
                        <span className="text-[11px] text-muted-foreground">{counts[opt]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onDownload}
              disabled={filtered.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>

          <div className="overflow-auto rounded-md border bg-card max-h-[calc(100vh-16rem)]">
            <table className="w-full min-w-[820px] border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-muted text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="border-b px-3 py-2 text-left">FSN ID</th>
                  <th className="border-b px-3 py-2 text-left">Weight Unit</th>
                  <th className="border-b px-3 py-2 text-right">Negotiated PP</th>
                  <th className="border-b px-3 py-2 text-right">RAAS Final Price</th>
                  <th className="border-b px-3 py-2 text-right">Difference</th>
                  <th className="border-b px-3 py-2 text-left">Mismatch Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No rows match this filter.
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => (
                    <tr
                      key={r.key}
                      className={`border-b last:border-b-0 hover:bg-muted/40 ${rowHighlightClass(r.status)}`}
                    >
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.fsnId || "—"}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={r.weightUnit.trim() || "NO weight unit"}>
                        {r.weightUnit.trim() || "NO weight unit"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inTool ? fmtPrice(r.negotiatedPp) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inRaas ? fmtPrice(r.raasFinalPrice) : (
                          <span className="text-muted-foreground">Not Found</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          r.difference !== null && r.difference !== 0
                            ? r.difference > 0
                              ? "text-amber-700"
                              : "text-sky-700"
                            : ""
                        }`}
                      >
                        {fmtDiff(r.difference)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadgeClass(r.status)}`}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                {filtered.length !== counts.all ? ` (filtered from ${counts.all})` : ""} · {PAGE_SIZE} per page
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="min-w-[5.5rem] text-center text-[11px] tabular-nums text-muted-foreground">
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
