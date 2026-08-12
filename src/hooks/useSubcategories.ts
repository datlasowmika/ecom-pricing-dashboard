import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type SubcategoryRow } from "@/lib/supabase";

export function subcategoryLookupKey(fsnId: string, skuId: string | undefined | null) {
  return `${fsnId}||${skuId ?? ""}`;
}

export function useSubcategories() {
  const [mappings, setMappings] = useState<SubcategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("subcategory")
      .select("subcategory, sku_id, fsn_id")
      .order("subcategory", { ascending: true });

    if (!error && data && data.length > 0) {
      setMappings(data as SubcategoryRow[]);
      setLoading(false);
      return;
    }

    const { data: fallback } = await supabase
      .from("price_sheet_details")
      .select("subcategory, sku_id, fsn_id")
      .not("subcategory", "is", null)
      .not("sku_id", "is", null)
      .not("fsn_id", "is", null);

    const seen = new Set<string>();
    const deduped: SubcategoryRow[] = [];
    for (const row of fallback ?? []) {
      const key = subcategoryLookupKey(row.fsn_id ?? "", row.sku_id);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        subcategory: row.subcategory!,
        sku_id: row.sku_id!,
        fsn_id: row.fsn_id!,
      });
    }
    deduped.sort((a, b) => a.subcategory.localeCompare(b.subcategory));
    setMappings(deduped);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMappings();
  }, [fetchMappings]);

  const subcategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mappings) {
      map.set(subcategoryLookupKey(m.fsn_id, m.sku_id), m.subcategory);
    }
    return map;
  }, [mappings]);

  const subcategoryNames = useMemo(
    () => Array.from(new Set(mappings.map((m) => m.subcategory))).sort((a, b) => a.localeCompare(b)),
    [mappings],
  );

  const resolveSubcategory = useCallback(
    (fsnId: string, skuId: string | undefined | null, fallback?: string) => {
      return subcategoryMap.get(subcategoryLookupKey(fsnId, skuId)) ?? fallback ?? "";
    },
    [subcategoryMap],
  );

  return { subcategoryNames, subcategoryMap, resolveSubcategory, loading, refetch: fetchMappings };
}
