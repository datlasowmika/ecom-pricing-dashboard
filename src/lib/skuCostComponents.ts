import { parseCSV, toNum } from "@/lib/csv";
import { fsnWeightKey, loadFsnWeightUnitMap } from "@/lib/fsnWeightUnit";
import { supabase } from "@/lib/supabase";

/** Fixed cost row — keyed by (fsn_id, weight_unit) in `fsn_cost_components`. */
export type FsnCostComponent = {
  fsn_id: string;
  weight_unit: string;
  pm_cost: number | null;
  fml_dump: number | null;
  pc: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** @deprecated use FsnCostComponent */
export type SkuCostComponent = FsnCostComponent;

const TABLE = "fsn_cost_components";

export function skuCostKey(fsnId: string, weightUnit: string | null | undefined) {
  return `${fsnId.trim()}||${weightUnit ?? ""}`;
}

function csvField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase());
    const v = found ? row[found]?.trim() : "";
    if (v) return v;
  }
  return undefined;
}

/** Parse SKU cost CSV → rows ready for upsert (weight_unit may still need MySQL enrichment). */
export function parseFsnCostCsvRows(text: string): Array<{
  fsn_id: string;
  weight_unit?: string;
  pm_cost: number | null;
  fml_dump: number | null;
  pc: number | null;
}> {
  const parsed = parseCSV(text);
  const out: Array<{
    fsn_id: string;
    weight_unit?: string;
    pm_cost: number | null;
    fml_dump: number | null;
    pc: number | null;
  }> = [];

  for (const row of parsed) {
    const fsn_id = csvField(row, "FSN ID", "fsn_id", "FSN", "fsn");
    if (!fsn_id) continue;
    out.push({
      fsn_id,
      weight_unit: csvField(
        row,
        "Weight (Weight Unit)",
        "weight_unit",
        "Weight Unit",
        "weightunit",
        "Weight",
      ),
      pm_cost: toNum(csvField(row, "Packaging Material Cost", "pm_cost", "PM Cost")),
      fml_dump: toNum(csvField(row, "FML + Dump", "fml_dump", "FML Dump", "FML")),
      pc: toNum(csvField(row, "Processing Cost", "pc", "PC")),
    });
  }
  return out;
}

/** Resolve canonical MySQL weight units when city is known. */
export async function resolveFsnCostWeightUnits(
  rows: Array<{ fsn_id: string; weight_unit?: string }>,
  city?: string,
): Promise<Array<{ fsn_id: string; weight_unit: string }>> {
  let weightMap: Record<string, string> = {};
  if (city) {
    const fsns = Array.from(new Set(rows.map((r) => r.fsn_id).filter(Boolean)));
    try {
      weightMap = await loadFsnWeightUnitMap(fsns, city);
    } catch (e) {
      console.warn(`MySQL weight-unit lookup failed for ${city}:`, e);
    }
  }

  const resolved: Array<{ fsn_id: string; weight_unit: string }> = [];
  for (const row of rows) {
    const fromMysql = weightMap[fsnWeightKey(row.fsn_id)];
    const weight_unit = (fromMysql || row.weight_unit || "").trim();
    if (!weight_unit) continue;
    resolved.push({ fsn_id: row.fsn_id.trim(), weight_unit });
  }
  return resolved;
}

/** Parse CSV and upsert all FSN + weight unit + cost columns into fsn_cost_components. */
export async function upsertFsnCostComponentsFromCsv(
  text: string,
  city?: string,
): Promise<number> {
  const parsed = parseFsnCostCsvRows(text);
  if (parsed.length === 0) throw new Error("No valid FSN rows found in CSV");

  const weightKeys = await resolveFsnCostWeightUnits(parsed, city);
  const weightByFsn = new Map(weightKeys.map((w) => [w.fsn_id.toUpperCase(), w.weight_unit]));

  const payload: FsnCostComponent[] = [];
  for (const row of parsed) {
    const weight_unit =
      weightByFsn.get(row.fsn_id.trim().toUpperCase()) ?? row.weight_unit?.trim();
    if (!weight_unit) {
      throw new Error(
        `Missing weight unit for FSN ${row.fsn_id}. Select a city or include Weight (Weight Unit) in the CSV.`,
      );
    }
    payload.push({
      fsn_id: row.fsn_id.trim(),
      weight_unit,
      pm_cost: row.pm_cost,
      fml_dump: row.fml_dump,
      pc: row.pc,
    });
  }

  return upsertFsnCostComponents(payload);
}

export async function fetchFsnCostComponentsByFsns(fsnIds: string[]): Promise<FsnCostComponent[]> {
  const unique = Array.from(new Set(fsnIds.map((f) => f.trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("fsn_id,weight_unit,pm_cost,fml_dump,pc,created_at,updated_at")
    .in("fsn_id", unique);
  if (error) throw error;
  return (data ?? []) as FsnCostComponent[];
}

export async function fetchAllFsnCostComponents(): Promise<FsnCostComponent[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("fsn_id,weight_unit,pm_cost,fml_dump,pc,created_at,updated_at")
    .order("fsn_id", { ascending: true })
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as FsnCostComponent[];
}

/** Lookup fixed pm_cost / fml_dump / pc for FSN + weight unit pairs. */
export async function fetchSkuCostComponents(
  pairs: Array<{ fsn_id: string; weight_unit: string | null }>,
): Promise<Map<string, Pick<FsnCostComponent, "pm_cost" | "fml_dump" | "pc">>> {
  const out = new Map<string, Pick<FsnCostComponent, "pm_cost" | "fml_dump" | "pc">>();
  const fsns = Array.from(new Set(pairs.map((p) => p.fsn_id).filter(Boolean)));
  if (fsns.length === 0) return out;

  const { data, error } = await supabase
    .from(TABLE)
    .select("fsn_id,weight_unit,pm_cost,fml_dump,pc")
    .in("fsn_id", fsns);
  if (error || !data) return out;

  for (const row of data as FsnCostComponent[]) {
    out.set(skuCostKey(row.fsn_id, row.weight_unit), {
      pm_cost: row.pm_cost,
      fml_dump: row.fml_dump,
      pc: row.pc,
    });
  }
  return out;
}

/** Apply reference-table costs onto detail rows when those columns are null. */
export async function applySkuCostComponents<
  T extends {
    fsn_id?: string | null;
    weight_unit?: string | null;
    pm_cost?: number | null;
    fml_dump?: number | null;
    pc?: number | null;
  },
>(rows: T[]): Promise<T[]> {
  const pairs = rows
    .filter((r) => r.fsn_id && (r.pm_cost == null || r.fml_dump == null || r.pc == null))
    .map((r) => ({ fsn_id: r.fsn_id!, weight_unit: r.weight_unit ?? null }));
  if (pairs.length === 0) return rows;

  const costs = await fetchSkuCostComponents(pairs);
  return rows.map((r) => {
    const key = skuCostKey(String(r.fsn_id ?? ""), r.weight_unit);
    const c = costs.get(key);
    if (!c) return r;
    return {
      ...r,
      pm_cost: r.pm_cost ?? c.pm_cost ?? null,
      fml_dump: r.fml_dump ?? c.fml_dump ?? null,
      pc: r.pc ?? c.pc ?? null,
    };
  });
}

/** Upsert fixed costs (CSV feed / SKU Configuration upload). */
export async function upsertFsnCostComponents(
  rows: Array<Pick<FsnCostComponent, "fsn_id" | "weight_unit" | "pm_cost" | "fml_dump" | "pc">>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const chunkSize = 500;
  let total = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      ...r,
      fsn_id: r.fsn_id.trim(),
      weight_unit: r.weight_unit.trim(),
      updated_at: now,
    }));
    const { error, count } = await supabase
      .from(TABLE)
      .upsert(chunk, { onConflict: "fsn_id,weight_unit", count: "exact" });
    if (error) throw error;
    total += count ?? chunk.length;
  }
  return total;
}

/** @deprecated use upsertFsnCostComponents */
export const upsertSkuCostComponents = upsertFsnCostComponents;
