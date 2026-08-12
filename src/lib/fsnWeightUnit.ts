import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withMysqlConnection } from "@/lib/mysqlDb";

/** asgard.City Name → id for cities used in the pricing dashboard. */
export const CITY_NAME_TO_ID: Record<string, number> = {
  Bengaluru: 2,
  Chennai: 3,
  Hyderabad: 13,
  Mumbai: 14,
  Nashik: 36,
  Coimbatore: 90,
  Trichy: 102,
};

export type FsnWeightUnitRow = {
  fsn: string;
  lotWeightId: number;
  weightUnitName: string;
  cityCode: number;
};

export type FsnWeightLookupResult = {
  /** Uppercased FSN → preferred WeightUnitName */
  weightUnits: Record<string, string>;
  /** No row in vormir.ProductExternalInternalMapping for this city */
  notInMapping: string[];
  /** In mapping, but no WeightUnitName resolved even with fallbacks */
  unresolved: string[];
}

/**
 * Prefer FK-lot weight units (matches Price Upload naming), then newest LotWeightId.
 */
export function pickPreferredWeightUnit(
  candidates: { lotWeightId: number; weightUnitName: string }[],
): string {
  if (candidates.length === 0) return "";
  const fk = candidates.filter((c) => /fk\s*lot/i.test(c.weightUnitName));
  const pool = fk.length > 0 ? fk : candidates;
  pool.sort((a, b) => b.lotWeightId - a.lotWeightId);
  return (pool[0]?.weightUnitName ?? "").trim();
}

export function fsnWeightKey(fsn: string) {
  return fsn.trim().toUpperCase();
}

type QueryMode = "strict" | "sfwm" | "loose";

function buildWeightSql(fsnPlaceholders: string, mode: QueryMode): string {
  if (mode === "loose") {
    // Mapping → Weight only (user checked weight units exist here).
    return `
select distinct
    m.fsnCode as FSN,
    m.lotWeightId as LotWeightId,
    w.WeightUnit as WeightUnitName,
    m.cityId as cityCode
from (
    select distinct fsnCode, skuId, lotWeightId, cityId
    from vormir.ProductExternalInternalMapping
    where fsnCode in (${fsnPlaceholders}) and cityId = ?
) m
join asgard.Weight w
    on w.id = m.lotWeightId
   and w.Deleted = 0
`;
  }

  if (mode === "sfwm") {
    // Drop Facility city match + LotWeightTypeId filter (common miss cause).
    return `
select distinct
    m.fsnCode as FSN,
    m.lotWeightId as LotWeightId,
    w.WeightUnit as WeightUnitName,
    m.cityId as cityCode
from (
    select distinct fsnCode, skuId, lotWeightId, cityId
    from vormir.ProductExternalInternalMapping
    where fsnCode in (${fsnPlaceholders}) and cityId = ?
) m
join asgard.SkuFacilityWeightMap sfwm
    on sfwm.SkuId = m.skuId
   and sfwm.LotWeightId = m.lotWeightId
   and sfwm.Deleted = 0
   and sfwm.SkuTypeId = 1
join asgard.Weight w
    on w.id = sfwm.LotWeightId
   and w.Deleted = 0
`;
  }

  // Strict: original business query.
  return `
select distinct
    m.fsnCode as FSN,
    m.lotWeightId as LotWeightId,
    w.WeightUnit as WeightUnitName,
    m.cityId as cityCode
from (
    select distinct fsnCode, skuId, lotWeightId, cityId
    from vormir.ProductExternalInternalMapping
    where fsnCode in (${fsnPlaceholders}) and cityId = ?
) m
join asgard.SkuFacilityWeightMap sfwm
    on sfwm.SkuId = m.skuId
   and sfwm.LotWeightId = m.lotWeightId
   and sfwm.Deleted = 0
   and sfwm.SkuTypeId = 1
   and sfwm.LotWeightTypeId in (2, 10, 21, 22, 23)
join asgard.Facility f
    on f.id = sfwm.FacilityId
   and f.cityId = m.cityId
join asgard.Weight w
    on w.id = sfwm.LotWeightId
   and w.Deleted = 0
`;
}

function parseWeightRows(rows: unknown[]): FsnWeightUnitRow[] {
  const out: FsnWeightUnitRow[] = [];
  for (const row of rows as Array<{
    FSN: string;
    LotWeightId: number;
    WeightUnitName: string;
    cityCode: number;
  }>) {
    const fsn = String(row.FSN ?? "").trim();
    const weightUnitName = String(row.WeightUnitName ?? "").trim();
    if (!fsn || !weightUnitName) continue;
    out.push({
      fsn,
      lotWeightId: Number(row.LotWeightId),
      weightUnitName,
      cityCode: Number(row.cityCode),
    });
  }
  return out;
}

async function queryMode(
  conn: import("mysql2/promise").Connection,
  fsnIds: string[],
  cityId: number,
  mode: QueryMode,
): Promise<FsnWeightUnitRow[]> {
  if (fsnIds.length === 0) return [];
  const out: FsnWeightUnitRow[] = [];
  const chunkSize = 200;
  for (let i = 0; i < fsnIds.length; i += chunkSize) {
    const chunk = fsnIds.slice(i, i + chunkSize);
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(buildWeightSql(ph, mode), [...chunk, cityId]);
    out.push(...parseWeightRows(rows as unknown[]));
  }
  return out;
}

async function fsnsInMapping(
  conn: import("mysql2/promise").Connection,
  fsnIds: string[],
  cityId: number,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (fsnIds.length === 0) return found;
  const chunkSize = 200;
  for (let i = 0; i < fsnIds.length; i += chunkSize) {
    const chunk = fsnIds.slice(i, i + chunkSize);
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `select distinct fsnCode from vormir.ProductExternalInternalMapping
       where fsnCode in (${ph}) and cityId = ?`,
      [...chunk, cityId],
    );
    for (const r of rows as Array<{ fsnCode: string }>) {
      const key = fsnWeightKey(String(r.fsnCode ?? ""));
      if (key) found.add(key);
    }
  }
  return found;
}

function rowsToPreferredMap(rows: FsnWeightUnitRow[]): Record<string, string> {
  const byFsn = new Map<string, { lotWeightId: number; weightUnitName: string }[]>();
  for (const row of rows) {
    const key = fsnWeightKey(row.fsn);
    if (!key) continue;
    const list = byFsn.get(key) ?? [];
    list.push({
      lotWeightId: row.lotWeightId,
      weightUnitName: row.weightUnitName,
    });
    byFsn.set(key, list);
  }

  const result: Record<string, string> = {};
  for (const [key, candidates] of byFsn) {
    const picked = pickPreferredWeightUnit(candidates);
    if (picked) result[key] = picked;
  }
  return result;
}

/**
 * Resolve weight units with fallbacks:
 * 1) strict business join
 * 2) sfwm without Facility/LotWeightTypeId filters
 * 3) mapping → Weight only
 */
export async function resolveFsnWeightUnits(
  fsnIds: string[],
  cityId: number,
): Promise<FsnWeightLookupResult> {
  const unique = Array.from(
    new Set(fsnIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (unique.length === 0) {
    return { weightUnits: {}, notInMapping: [], unresolved: [] };
  }

  return withMysqlConnection(async (conn) => {
    const weightUnits: Record<string, string> = {};
    let pending = [...unique];

    for (const mode of ["strict", "sfwm", "loose"] as QueryMode[]) {
      if (pending.length === 0) break;
      const rows = await queryMode(conn, pending, cityId, mode);
      const map = rowsToPreferredMap(rows);
      Object.assign(weightUnits, map);
      pending = pending.filter((f) => !weightUnits[fsnWeightKey(f)]);
    }

    const mapped = await fsnsInMapping(conn, pending, cityId);
    const notInMapping: string[] = [];
    const unresolved: string[] = [];
    for (const fsn of pending) {
      const key = fsnWeightKey(fsn);
      if (mapped.has(key)) unresolved.push(fsn.trim());
      else notInMapping.push(fsn.trim());
    }

    return { weightUnits, notInMapping, unresolved };
  });
}

/**
 * Server-only: FSN → preferred WeightUnitName from vormir/asgard MySQL.
 */
export const fetchFsnWeightUnitLookup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fsnIds: z.array(z.string()),
      city: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<FsnWeightLookupResult> => {
    const cityId = CITY_NAME_TO_ID[data.city];
    if (cityId == null) {
      throw new Error(`No cityId mapping for city "${data.city}"`);
    }
    return resolveFsnWeightUnits(data.fsnIds, cityId);
  });

/** @deprecated Prefer loadFsnWeightUnitLookup — kept for enrichRows helpers. */
export const fetchFsnWeightUnitMap = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fsnIds: z.array(z.string()),
      city: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const cityId = CITY_NAME_TO_ID[data.city];
    if (cityId == null) {
      throw new Error(`No cityId mapping for city "${data.city}"`);
    }
    const result = await resolveFsnWeightUnits(data.fsnIds, cityId);
    return result.weightUnits;
  });

/** Resolve weight units by city name (server-side; no extra HTTP hop). */
export async function resolveFsnWeightUnitsForCity(
  fsnIds: string[],
  city: string,
): Promise<FsnWeightLookupResult> {
  const cityId = CITY_NAME_TO_ID[city];
  if (cityId == null) {
    throw new Error(`No cityId mapping for city "${city}"`);
  }
  return resolveFsnWeightUnits(fsnIds, cityId);
}

export async function loadFsnWeightUnitLookup(
  fsnIds: string[],
  city: string,
): Promise<FsnWeightLookupResult> {
  const unique = Array.from(
    new Set(fsnIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (unique.length === 0 || !city.trim()) {
    return { weightUnits: {}, notInMapping: [], unresolved: [] };
  }
  return fetchFsnWeightUnitLookup({ data: { fsnIds: unique, city } });
}

export async function loadFsnWeightUnitMap(
  fsnIds: string[],
  city: string,
): Promise<Record<string, string>> {
  const result = await loadFsnWeightUnitLookup(fsnIds, city);
  return result.weightUnits;
}

/**
 * Overlay MySQL weight units onto pricing_sheet-shaped rows.
 * Preserves the original Supabase value on `weight_unit_db` for row matching.
 */
export async function enrichRowsWithMysqlWeightUnits<
  T extends { fsn_id?: string | null; weight_unit?: string | null },
>(rows: T[], city: string): Promise<(T & { weight_unit_db?: string | null })[]> {
  if (!city || rows.length === 0) return rows;
  const fsnIds = rows.map((r) => r.fsn_id ?? "").filter(Boolean);
  let map: Record<string, string> = {};
  try {
    map = await loadFsnWeightUnitMap(fsnIds, city);
  } catch (e) {
    console.warn("MySQL weight-unit lookup failed; keeping pricing_sheet values:", e);
    return rows;
  }
  if (Object.keys(map).length === 0) return rows;

  return rows.map((r) => {
    const key = fsnWeightKey(r.fsn_id ?? "");
    const fromMysql = key ? map[key] : undefined;
    if (!fromMysql) return r;
    return {
      ...r,
      weight_unit_db: r.weight_unit ?? null,
      weight_unit: fromMysql,
    };
  });
}
