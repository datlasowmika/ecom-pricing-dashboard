import { loadDemandForPricingSheet } from "@/lib/demandSheet";
import {
  fetchExistingPriceSheetDates,
  loadOrCreatePriceSheet,
  priceSheetHeaderExists,
  upsertPriceSheetDetails,
  fetchPriceSheetHeader,
} from "@/lib/priceSheetDb";
import type { PriceSheetDetailRow } from "@/lib/supabase";

/** Rolling window: pricing sheets within this many days ago are served from Supabase cache. */
export const PRICING_SHEET_CACHE_DAYS = 7;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Whole days between deliveryDate and today (positive = past, negative = future). */
export function daysBeforeToday(deliveryDate: string): number {
  const today = todayISO();
  const t = new Date(`${today}T12:00:00`).getTime();
  const d = new Date(`${deliveryDate}T12:00:00`).getTime();
  return Math.round((t - d) / 86_400_000);
}

export function isWithinPricingSheetCacheWindow(deliveryDate: string): boolean {
  const days = daysBeforeToday(deliveryDate);
  return days >= 0 && days <= PRICING_SHEET_CACHE_DAYS;
}

/** Dates from today back through the cache window (today, yesterday, …). */
export function getPricingSheetCacheWindowDates(): string[] {
  const today = todayISO();
  const dates: string[] = [];
  for (let i = 0; i <= PRICING_SHEET_CACHE_DAYS; i++) {
    dates.push(addDaysISO(today, -i));
  }
  return dates;
}

export async function pricingSheetExists(city: string, deliveryDate: string): Promise<boolean> {
  return priceSheetHeaderExists(city, deliveryDate);
}

export async function pricingSheetExistingDates(
  city: string,
  dates: string[],
): Promise<Set<string>> {
  return fetchExistingPriceSheetDates(city, dates);
}

async function upsertDemandRows(
  priceSheetId: string,
  payload: Partial<PriceSheetDetailRow>[],
): Promise<number> {
  return upsertPriceSheetDetails(priceSheetId, payload);
}

export type PricingSheetLoadResult =
  | { source: "cache" }
  | { source: "demand"; rowCount: number };

/**
 * Load demand for a pricing sheet, using Supabase as a 7-day cache when possible.
 * Dates older than the cache window always hit MySQL.
 */
export async function loadPricingSheetDemand(
  deliveryDate: string,
  city: string,
): Promise<PricingSheetLoadResult> {
  const inWindow = isWithinPricingSheetCacheWindow(deliveryDate);

  if (inWindow) {
    const exists = await pricingSheetExists(city, deliveryDate);
    if (exists) {
      void prefetchMissingPricingSheetDates(city, deliveryDate);
      return { source: "cache" };
    }
  }

  const result = await loadOrCreatePriceSheet(city, deliveryDate, { createIfMissing: true });
  if (!result || result.rows.length === 0) {
    return { source: "demand", rowCount: 0 };
  }

  if (inWindow) {
    void prefetchMissingPricingSheetDates(city, deliveryDate);
  }

  return { source: "demand", rowCount: result.rows.length };
}

/** Background: fetch and store demand for other cache-window dates missing from Supabase. */
export async function prefetchMissingPricingSheetDates(
  city: string,
  skipDate?: string,
): Promise<void> {
  const windowDates = getPricingSheetCacheWindowDates().filter((d) => d !== skipDate);
  const existing = await pricingSheetExistingDates(city, windowDates);
  const missing = windowDates.filter((d) => !existing.has(d));

  for (const date of missing) {
    try {
      await loadOrCreatePriceSheet(city, date, { createIfMissing: true });
    } catch (e) {
      console.warn(`Background pricing sheet prefetch failed for ${city} ${date}:`, e);
    }
  }
}

/** Demand upload: upsert detail rows into an existing or newly created header. */
export async function upsertDemandUploadRows(
  city: string,
  deliveryDate: string,
  payload: Partial<PriceSheetDetailRow>[],
): Promise<number> {
  let header = await fetchPriceSheetHeader(city, deliveryDate);
  if (!header) {
    const created = await loadOrCreatePriceSheet(city, deliveryDate, { createIfMissing: true });
    if (!created) throw new Error("Failed to create price sheet header");
    header = created.header;
  }
  return upsertDemandRows(header.price_sheet_id, payload);
}
