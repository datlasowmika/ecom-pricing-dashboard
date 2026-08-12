import { useCallback, useEffect, useState } from "react";
import { enrichRowsWithMysqlWeightUnits } from "@/lib/fsnWeightUnit";
import {
  fetchPriceSheetDetails,
  fetchPriceSheetHeader,
  loadOrCreatePriceSheet,
  mergeHeaderAndDetails,
  submitPriceSheet,
  updatePriceSheetDetail,
  upsertPriceSheetDetails,
} from "@/lib/priceSheetDb";
import { applySkuCostComponents } from "@/lib/skuCostComponents";
import { supabase, type PriceSheetDetailRow, type PricingSheetRow } from "@/lib/supabase";

export function usePricingSheet(params: { city?: string; deliveryDate?: string; autoFetch?: boolean }) {
  const { city, deliveryDate, autoFetch = true } = params;
  const [rows, setRows] = useState<PricingSheetRow[]>([]);
  const [priceSheetId, setPriceSheetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    if (!city || !deliveryDate) {
      setRows([]);
      setPriceSheetId(null);
      return;
    }
    setLoading(true);
    setError(null);

    const header = await fetchPriceSheetHeader(city, deliveryDate);
    if (!header) {
      setRows([]);
      setPriceSheetId(null);
      setLoading(false);
      return;
    }

    let result = mergeHeaderAndDetails(header, await fetchPriceSheetDetails(header.price_sheet_id));
    result = await applySkuCostComponents(result);
    setPriceSheetId(header.price_sheet_id);

    if (city) {
      result = (await enrichRowsWithMysqlWeightUnits(result, city)) as PricingSheetRow[];
    }

    setRows(result);
    setLoading(false);
  }, [city, deliveryDate]);

  useEffect(() => {
    if (!autoFetch) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchRows();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRows, autoFetch]);

  const updateRow = useCallback(
    async (
      match: { id?: string; price_sheet_details_id?: string; fsn_id?: string; weight_unit?: string | null },
      patch: Partial<PricingSheetRow>,
    ) => {
      if (!priceSheetId) throw new Error("No price sheet loaded");

      const detailPatch: Partial<PriceSheetDetailRow> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "delivery_date" || k === "city" || k === "city_id" || k === "id") continue;
        (detailPatch as Record<string, unknown>)[k] = v;
      }

      const rowMatchKey = (r: PricingSheetRow) => r.weight_unit_db ?? r.weight_unit ?? null;
      const detailId = match.price_sheet_details_id ?? match.id;
      setRows((rs) =>
        rs.map((r) => {
          const hit =
            (detailId && r.id === detailId) ||
            (match.fsn_id &&
              r.fsn_id === match.fsn_id &&
              (match.weight_unit ?? null) === rowMatchKey(r));
          return hit ? { ...r, ...patch } : r;
        }),
      );

      const updated = await updatePriceSheetDetail(priceSheetId, match, detailPatch);
      if (!updated) return null;

      const header = city && deliveryDate ? await fetchPriceSheetHeader(city, deliveryDate) : null;
      const merged: PricingSheetRow = {
        ...updated,
        id: updated.price_sheet_details_id ?? updated.id,
        delivery_date: deliveryDate ?? "",
        city: city ?? "",
        city_id: header?.city_id ?? null,
        submitted: updated.submitted ?? header?.status !== "Created",
      };

      setRows((rs) =>
        rs.map((r) => {
          const hit =
            (detailId && r.id === detailId) ||
            (match.fsn_id &&
              r.fsn_id === match.fsn_id &&
              (match.weight_unit ?? null) === rowMatchKey(r));
          return hit
            ? {
                ...merged,
                weight_unit: r.weight_unit,
                weight_unit_db: r.weight_unit_db ?? r.weight_unit,
              }
            : r;
        }),
      );
      return merged;
    },
    [city, deliveryDate, priceSheetId],
  );

  const upsertMany = useCallback(
    async (payload: Partial<PricingSheetRow>[]) => {
      if (!priceSheetId && city && deliveryDate) {
        const loaded = await loadOrCreatePriceSheet(city, deliveryDate);
        if (!loaded) throw new Error("Could not create price sheet");
        setPriceSheetId(loaded.header.price_sheet_id);
      }
      const sheetId = priceSheetId ?? (await fetchPriceSheetHeader(city!, deliveryDate!))?.price_sheet_id;
      if (!sheetId) throw new Error("No price sheet for upsert");

      const detailPayload: Partial<PriceSheetDetailRow>[] = payload.map((p) => {
        const { delivery_date: _d, city: _c, city_id: _ci, id: _id, ...rest } = p;
        return rest as Partial<PriceSheetDetailRow>;
      });
      const inserted = await upsertPriceSheetDetails(sheetId, detailPayload);
      await fetchRows();
      return { inserted };
    },
    [city, deliveryDate, fetchRows, priceSheetId],
  );

  const submitSheet = useCallback(async () => {
    if (!city || !deliveryDate) throw new Error("City and delivery date required");
    const header = await submitPriceSheet(city, deliveryDate);
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        submitted: true,
      })),
    );
    return header;
  }, [city, deliveryDate]);

  return {
    rows,
    priceSheetId,
    loading,
    error,
    refetch: fetchRows,
    updateRow,
    upsertMany,
    submitSheet,
  };
}
