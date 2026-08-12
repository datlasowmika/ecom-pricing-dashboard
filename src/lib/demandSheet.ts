import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withMysqlConnection } from "@/lib/mysqlDb";
import { CITY_NAME_TO_ID, fsnWeightKey, resolveFsnWeightUnitsForCity } from "@/lib/fsnWeightUnit";
import type { PricingSheetRow } from "@/lib/supabase";

export type DemandQueryRow = {
  DeliveryDate: string | null;
  City: string | null;
  cityid: number | null;
  FSN: string | null;
  weightunit: string | null;
  SkuId: string | number | null;
  SKU: string | null;
  Flag: number | null;
  CF: number | null;
  bucket: string | null;
  subcat: string | null;
  orderedlot: number | null;
  Mix: number | null;
  "T-1 GRN Qty": number | null;
  "T-2 GRN Qty": number | null;
  "T-3 GRN Qty": number | null;
  "T-1 GRN Unit": number | null;
  "T-2 GRN Unit": number | null;
  "T-3 GRN Unit": number | null;
};

/** Escape a string for safe embedding in a single-quoted MySQL literal. */
function escapeSqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * Demand + historical GRN mix query (Master SO Type=23), parameterized by delivery date + city.
 * Placeholders: {{Deliverydate}} (YYYY-MM-DD), {{City}} (city display name).
 */
const DEMAND_SQL_TEMPLATE = `
select base.*,
round(base.orderedlot*100/base2.orderedlot,3) as Mix,
case when flag=1 then base3.t2_grn else base1.t2_grn end as t1_grn_qty,
case when flag=1 then base3.t3_grn else base1.t3_grn end as t2_grn_qty,
case when flag=1 then base3.t4_grn else base1.t4_grn end as t3_grn_qty,

case when flag=1 then base3.t2_grn*base.CF else base1.t2_grn*base.CF end as t1_grn_unit,
case when flag=1 then base3.t3_grn*base.CF else base1.t3_grn*base.CF end as t2_grn_unit,
case when flag=1 then base3.t4_grn*base.CF else base1.t4_grn*base.CF end as t3_grn_unit
from(
select
DeliveryDate,
City,
cityid,
FSN,
weightunit,
SkuId,
SKU,
case when (SKU like "%Onion%" or SKU like "%Potato%" or SKU like "%Garlic%" or SKU like "%Ginger%" or SKU like "%Navel%" or Sku like "%Tender%") then 1 else 0 end as Flag,
CF,
bucket,
subcat,
sum(orderedlot) as orderedlot
from(
select
date as DeliveryDate,
City as City,
cityid,
FacilityId as FacilityId,
Facility as Facility,
soid AS SaleOrderId,
Sotype as SoType,
skuid as SkuId,
sku as SKU,
concat(UOM, ' ', baseweight) as UOM,
lotweight as lotweightId,
FSN as FSN,
FSN_Name as ProductName,
weightunit,
CF,
bucket,
subcat,
round(sum(orderedlot), 2) as orderedlot
from
(
select
so.DeliveryDate as date,
sod.id as sodid,
ci.name as City,
ci.id as cityid,
f.id as FacilityId,
f.name as Facility,
so.SubType,
so.Type as SO_Type,
case
when so.Type in (1, 2) then 'FnV SO'
when so.Type in (6) then 'Grocery SO'
when so.Type in (23) then 'Master SO'
end as Sotype,
c.id as CustomerId,
c.name as Customer,
pei.fsnCode as FSN,
externalProductName AS FSN_Name,
case
when bp.Name like "%Dunzo%" then "DunzoDarkstores"
else bp.Name
end as Buisnesspartnername,
so.id as soid,
s.id as skuid,
s.Name as sku,
soa.RefidStr as POnumber,
w.weightunit as weightunit,
w.ConversionToBase as UOM,
s.CategoryId as SkuCategoryId,
sc2.Name as SkuCategory,
case
when w.BaseWeight = 1 then 'Kg'
when w.BaseWeight = 2 then 'Pcs'
end as baseweight,
sod.lotweightid as lotweight,
sod.saleprice as saleprice,
sod.Deleted as Deleted,
sod.SkuQuantity as OrderedQuanity,
sod.BilledQuantity as Billedquanity,
w.conversiontobase as CF,
sod.FulfilledQuantity as FulfilledQuantity,
sod.FulfilledQuantity as ffqty,
round(sod.SalePrice * w.ConversionTobase, 2) as ReducedMRP,
sod.SkuQuantity / w.ConversionToBase as orderedlot,
sod.WeightShortageQuantity / w.ConversionToBase as WeightShortagelot,
case
when so.Deleted = 0 then sod.WeightShortageQuantity * sco.ConversionToKgs
end as weightshortagequantitykgs,
sod.FulfilledQuantity / w.ConversionToBase as Fulfilledlot,
ssc.Name as SubCategory,
i.id as InvoiceId,
tag.bucket,
tag1.subcat
from
SaleOrderDetails sod
left join SaleOrder so on sod.SaleOrderId = so.id
left join Invoice i on i.SaleOrderId = so.id
left join SaleOrderDetailAdditionalInfo soda on soda.SaleOrderDetailId = sod.id
and ifnull(soda.ConversionType, 0) != 0
left join SaleOrderAdditionalInfo soa on soa.SaleOrderId = so.id
left join Weight w on sod.LotWeightId = w.id
left join Customer c on c.id = so.CustomerId
left join CustomerAttribute ca on ca.CustomerId = c.id
and ca.Deleted = 0
left join Sku s on sod.SkuId = s.id
left join SkuCategory sc2 on sc2.id = s.CategoryId
left join SkuSubCategory ssc on ssc.id = s.SubCategoryId
left join SkuClassification sc on sc.id = s.SkuClassificationId
left join SkuConfiguration sco on sco.SkuId = s.id
and sco.Deleted = 0
left join BusinessPartner bp on bp.id = ca.BusinessPartnerId
left join City ci on ci.id = so.CityId
left join Facility f on so.FacilityId = f.id
left join datalake.FK_Subcat_Tag tag1 on tag1.skuid=s.id
left join (
select
pei.externalProductName,
pei.fsnCode,
pei.externalProductId,
externalProductUnit,
pei.hsnCode,
pei.skuid,
pei.lotWeightId,
cityid,
pei.externalOutletId
from
vormir.ProductExternalInternalMapping pei
) pei on so.CityId = pei.CityId
and sod.SkuId = pei.skuid
and sod.lotWeightId = pei.lotWeightId
and pei.externalOutletId = so.CustomerId
left join datalake.FK_Sku_Tag tag on tag.Cityid=ci.id and tag.FSN=pei.fsncode
where
so.DeliveryDate = '{{Deliverydate}}'
and ca.InvoiceType = 0
and (
ifnull(bp.partnertype, 'B2B') = 'B2C'
or bp.id = 106
)
and so.Type = 23
and sod.deleted = 0
and so.Deleted = 0
and ci.Name='{{City}}'
group by
so.DeliveryDate,
sod.SKuid,
so.FacilityId,
so.CustomerId,
sod.LotWeightId,
soid
) base1
group by
date,
SaleOrderId,
weightunit
)base
group by DeliveryDate,
City,
FSN,
weightunit,
SkuId,
SKU,
CF
)base
left join(
select
CityId,
SkuId,
sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 2 day then GRN_Value end)/sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 2 day then GRNQuantity end) as t2_grn,
sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 3 day then GRN_Value end)/sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 3 day then GRNQuantity end) as t3_grn,
sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 4 day then GRN_Value end)/sum(case when PurchaseOrderDate='{{Deliverydate}}'-interval 4 day then GRNQuantity end) as t4_grn
from(
select
po.deliverydate as PurchaseOrderDate,
ci.id as CityId,
ci.Name as City,
po.id as PurchaseOrderId,
pod.id as PurchaseOrderDetailsId,
g.id as GRNId,
f.id as FacilityId,
f.name as Facility,
v.id as VendorId,
v.name as VendorName,
w.weightUnit as WeightUnit,
pod.skuid as SkuId,
s.name as Sku,
w.BaseWeight as baseweight,
pod.skuquantity as POQuantity,
gd.skuquantity as GRNQuantity,
pod.suppliedquantity as po_suppliedQuantity,
pod.purchaseprice as PurchasePrice,
gd.purchaseprice  as GRNPrice,
g.PaymentStatusText as Payment_status,
pod.consumptiondate as consumptionDate,
date(max(g.createdat)) as maxGRNdate,
gd.purchaseprice * gd.skuquantity as GRN_Value
from PurchaseOrder po
left join PurchaseOrderAdditionInfo poa on poa.PurchaseOrderId=po.id and poa.Deleted=0
left join  PurchaseOrderDetails pod on pod.purchaseorderid=po.id
left join GRNDetails gd on gd.purchaseorderdetailsid=pod.id
left join GRN g on g.id=gd.grnid
left join Sku s on s.id=pod.skuid
left join Facility  f on f.id=po.facilityid
left join Vendor v on v.id=po.vendorid
left join VendorType vt on vt.id=v.vendortypeid
left join Weight w on w.id=pod.weightid
left join City ci on ci.id = po.CityId
left join AsgardFacilityConfiguration afc on afc.FacilityId=po.FacilityId
where
po.type in (1)
and pod.SkuTypeId != 18
and po.deliverydate between '{{Deliverydate}}'-interval 4 day and '{{Deliverydate}}'-interval 2 day
and po.Deleted = 0
and afc.VirtualFacilityType='B2C_HANDLING'
and pod.deleted = 0
group by pod.id
)base
group by
CityId,
SkuId
)base1 on base1.CityId=base.cityid and base1.skuid=base.skuid
left join(

select
DeliveryDate,
City,
cityid,
sum(orderedlot) as orderedlot
from(
select
date as DeliveryDate,
City as City,
cityid,
FacilityId as FacilityId,
Facility as Facility,
soid AS SaleOrderId,
Sotype as SoType,
skuid as SkuId,
sku as SKU,
concat(UOM, ' ', baseweight) as UOM,
lotweight as lotweightId,
weightunit,
CF,
round(sum(orderedlot), 2) as orderedlot
from
(
select
so.DeliveryDate as date,
sod.id as sodid,
ci.name as City,
ci.id as cityid,
f.id as FacilityId,
f.name as Facility,
so.SubType,
so.Type as SO_Type,
case
when so.Type in (1, 2) then 'FnV SO'
when so.Type in (6) then 'Grocery SO'
when so.Type in (23) then 'Master SO'
end as Sotype,
c.id as CustomerId,
c.name as Customer,
case
when bp.Name like "%Dunzo%" then "DunzoDarkstores"
else bp.Name
end as Buisnesspartnername,
so.id as soid,
s.id as skuid,
s.Name as sku,
soa.RefidStr as POnumber,
w.weightunit as weightunit,
w.ConversionToBase as UOM,
s.CategoryId as SkuCategoryId,
sc2.Name as SkuCategory,
case
when w.BaseWeight = 1 then 'Kg'
when w.BaseWeight = 2 then 'Pcs'
end as baseweight,
sod.lotweightid as lotweight,
sod.saleprice as saleprice,
sod.Deleted as Deleted,
sod.SkuQuantity as OrderedQuanity,
sod.BilledQuantity as Billedquanity,
w.conversiontobase as CF,
sod.FulfilledQuantity as FulfilledQuantity,
sod.FulfilledQuantity as ffqty,
round(sod.SalePrice * w.ConversionTobase, 2) as ReducedMRP,
sod.SkuQuantity / w.ConversionToBase as orderedlot,
sod.WeightShortageQuantity / w.ConversionToBase as WeightShortagelot,
case
when so.Deleted = 0 then sod.WeightShortageQuantity * sco.ConversionToKgs
end as weightshortagequantitykgs,
sod.FulfilledQuantity / w.ConversionToBase as Fulfilledlot,
ssc.Name as SubCategory,
i.id as InvoiceId
from
SaleOrderDetails sod
left join SaleOrder so on sod.SaleOrderId = so.id
left join Invoice i on i.SaleOrderId = so.id
left join SaleOrderDetailAdditionalInfo soda on soda.SaleOrderDetailId = sod.id
and ifnull(soda.ConversionType, 0) != 0
left join SaleOrderAdditionalInfo soa on soa.SaleOrderId = so.id
left join Weight w on sod.LotWeightId = w.id
left join Customer c on c.id = so.CustomerId
left join CustomerAttribute ca on ca.CustomerId = c.id
and ca.Deleted = 0
left join Sku s on sod.SkuId = s.id
left join SkuCategory sc2 on sc2.id = s.CategoryId
left join SkuSubCategory ssc on ssc.id = s.SubCategoryId
left join SkuClassification sc on sc.id = s.SkuClassificationId
left join SkuConfiguration sco on sco.SkuId = s.id
and sco.Deleted = 0
left join BusinessPartner bp on bp.id = ca.BusinessPartnerId
left join City ci on ci.id = so.CityId
left join Facility f on so.FacilityId = f.id
where
so.DeliveryDate = '{{Deliverydate}}'
and ca.InvoiceType = 0
and (
ifnull(bp.partnertype, 'B2B') = 'B2C'
or bp.id = 106
)
and so.Type = 23
and sod.deleted = 0
and so.Deleted = 0
group by
so.DeliveryDate,
sod.SKuid,
so.FacilityId,
so.CustomerId,
sod.LotWeightId,
soid
) base1
group by
date,
SaleOrderId,
weightunit
)base
group by DeliveryDate,
Cityid

)base2 on base2.DeliveryDate=base.DeliveryDate and base2.cityid=base.cityid

left join(
select
base.City,
Skuid,
sum(case when DeliveryDate='{{Deliverydate}}'-interval 2 day then Cogs_Value end)/sum(case when DeliveryDate='{{Deliverydate}}'-interval 2 day then FulfilledQuantity end) as t2_grn,
sum(case when DeliveryDate='{{Deliverydate}}'-interval 3 day then Cogs_Value end)/sum(case when DeliveryDate='{{Deliverydate}}'-interval 3 day then FulfilledQuantity end) as t3_grn,
sum(case when DeliveryDate='{{Deliverydate}}'-interval 4 day then Cogs_Value end)/sum(case when DeliveryDate='{{Deliverydate}}'-interval 4 day then FulfilledQuantity end) as t4_grn
from(
select
so.DeliveryDate as DeliveryDate,
ci.id as CityId,
ci.name as City,
f.id as FacilityId,
f.name as Facility,
sod.id as SaleOrderDetailsId,
so.id as SaleOrderId,
so.SubType as SOSubType,
so.Type as SOType,
so.Status as SOStatus,
c.id as CustomerId,
c.name as Customer,
bp.id as BusinessPartnerId,
bp.Name as Buisnesspartnername,
s.id as Skuid,
s.Name as Sku,
w.ConversionToBase,
w.weightunit as weightunit,
s.CategoryId as SkuCategoryId,
w.BaseWeight as baseweight,
sod.lotweightid as lotweightId,
sod.saleprice as saleprice,
sod.Deleted as Deleted,
sod.SkuQuantity as OrderQuantity,
sod.BilledQuantity as BilledQuantity,
sod.FulfilledQuantity as FulfilledQuantity,
sod.ReturnQuantity as ReturnsQuantity,
sod.SkuQuantity / w.ConversionToBase as Orderlot,
sod.BilledQuantity / w.ConversionToBase as Billedlot,
sod.FulfilledQuantity / w.ConversionToBase as Fulfilledlot,
sod.ReturnQuantity / w.ConversionToBase as Returnslot,
sod.SkuQuantity * sco.ConversionToKgs as OrderKg,
sod.BilledQuantity * sco.ConversionToKgs as BilledKg,
sod.FulfilledQuantity * sco.ConversionToKgs as FulfilledKg,
sod.ReturnQuantity * sco.ConversionToKgs as ReturnsKg,
sod.SkuQuantity * sod.SalePrice as OrderValue,
sod.BilledQuantity * sod.SalePrice as BilledValue,
sod.FulfilledQuantity * sod.SalePrice as FulfilledValue,
sod.ReturnQuantity * sod.SalePrice as ReturnsValue,
round(
(
(
case
when so.subtype in (15) then ifnull(aca3.Price, 0)
when f.TypeId = 1
and so.subtype != 15 then ifnull(ACA1.Price, 0)
else ifnull(ACA.Price, 0)
end
) / (
sco.ConversionToKgs / coalesce(soda.ConversionFactor, sco.ConversionToKgs)
)
),
2
) as cogs,
ROUND(
(
case
when so.Deleted = 0
and sod.Deleted = 0
and so.Status = 5 then sod.FulfilledQuantity
end
) *(
case
when so.subtype in (15) then ifnull(aca3.Price, 0)
when f.TypeId = 1
and so.subtype != 15 then ifnull(ACA1.Price, 0)
else ifnull(ACA.Price, 0)
end
) / (
sco.ConversionToKgs / coalesce(soda.ConversionFactor, sco.ConversionToKgs)
),
2
) as Cogs_Value,
pei.fsncode as FSN
from
SaleOrder so
left join SaleOrderDetails sod on sod.SaleOrderId = so.id
left join SaleOrderDetailAdditionalInfo soda on soda.SaleOrderDetailId = sod.id
and ifnull(soda.ConversionType, 0) != 0
left join SaleOrderAdditionalInfo soa on soa.SaleOrderId = so.id
left join Weight w on sod.LotWeightId = w.id
left join Customer c on c.id = so.CustomerId
left join CustomerAttribute ca on ca.CustomerId = c.id
and ca.Deleted = 0
left join Sku s on sod.SkuId = s.id
left join SkuConfiguration sco on sco.SkuId = s.id
and sco.Deleted = 0
join BusinessPartner bp on bp.id = soa.BusinessPartnerId
left join City ci on ci.id = so.CityId
left join Facility f on so.FacilityId = f.id
left join datalake.AverageCostAttribution ACA on ACA.SkuId = sod.SkuId
and ACA.FacilityId = so.FacilityId
and ACA.AttributionDate = so.DeliveryDate
and ACA.Deleted = 0
left join datalake.AverageCostAttribution ACA1 on ACA1.SkuId = sod.SkuId
and ACA1.FacilityId = so.FacilityId
and ACA1.AttributionDate = so.DeliveryDate - interval 1 day
and ACA1.Deleted = 0
left join datalake.AverageCostAttribution aca3 on aca3.SkuId = sod.SkuId
and aca3.FacilityId = so.FacilityId
and aca3.AttributionDate = so.DeliveryDate

left join
(
select pei.externalProductName ,pei.fsnCode ,pei.externalProductId ,externalProductUnit ,pei.hsnCode,pei.skuid,pei.lotWeightId,cityid, pei.externalOutletId
from
vormir.ProductExternalInternalMapping pei
left join City c on c.id=pei.cityid
where c.Name='{{City}}'
)pei on so.CityId=pei.CityId and sod.SkuId=pei.skuid and sod.lotWeightId=pei.lotWeightId and pei.externalOutletId = so.CustomerId


where
so.DeliveryDate between '{{Deliverydate}}'-interval 4 day and '{{Deliverydate}}'-interval 2 day
and ca.InvoiceType = 0
and ci.Name='{{City}}'
and f.id in (9382,9892,9920,9575,10078,10071,10112)
and (
ifnull(bp.partnertype, 'B2B') = 'B2C'
or bp.id = 106
)
and so.Type in (1, 2, 7, 9)
and (
(sod.deleted = 0)
or (
sod.Deleted = 1
and sod.SkuQuantity != sod.BilledQuantity
)
)
and so.Deleted = 0
and so.status = 5
group by
so.DeliveryDate,
sod.SKuid,
so.FacilityId,
so.CustomerId,
sod.LotWeightId,
so.id
) base
group by city,skuid
)base3 on base3.city=base.city and base3.skuid=base.skuid
`;

function buildDemandSql(deliveryDate: string, city: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    throw new Error(`Invalid delivery date "${deliveryDate}" (expected YYYY-MM-DD)`);
  }
  if (CITY_NAME_TO_ID[city] == null) {
    throw new Error(`No cityId mapping for city "${city}"`);
  }
  const d = escapeSqlString(deliveryDate);
  const c = escapeSqlString(city);
  return DEMAND_SQL_TEMPLATE.replaceAll("{{Deliverydate}}", d).replaceAll("{{City}}", c);
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(v: unknown, fallback: string): string {
  if (v == null || v === "") return fallback;
  const s = String(v);
  // MySQL dateStrings / Date → prefer YYYY-MM-DD
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return fallback;
}

function rowGet(r: Record<string, unknown>, ...keys: string[]): unknown {
  const headers = Object.keys(r);
  for (const k of keys) {
    const found = headers.find((h) => h.toLowerCase() === k.toLowerCase());
    if (found !== undefined) return r[found];
  }
  return undefined;
}

function mapDemandRowToSheet(
  r: Record<string, unknown>,
  fallbackDate: string,
  fallbackCity: string,
): Partial<PricingSheetRow> | null {
  const delivery_date = toIsoDate(rowGet(r, "DeliveryDate", "delivery_date"), fallbackDate);
  const cityRaw = rowGet(r, "City", "city");
  const city = cityRaw != null && String(cityRaw).trim() !== ""
    ? String(cityRaw).trim()
    : fallbackCity;
  const skuRaw = rowGet(r, "SkuId", "sku_id", "skuid");
  const sku_id = skuRaw != null && String(skuRaw).trim() !== ""
    ? String(skuRaw).trim()
    : null;
  if (!delivery_date || !city || !sku_id) return null;

  const cityIdNum = toFiniteNumber(rowGet(r, "cityid", "CityId", "city_id"));
  const fsnRaw = rowGet(r, "FSN", "fsn_id", "fsn");
  const skuName = rowGet(r, "SKU", "sku_name", "sku");
  const weightUnit = rowGet(r, "weightunit", "weight_unit", "WeightUnit");
  const bucket = rowGet(r, "bucket", "Bucket");
  const subcat = rowGet(r, "subcat", "subcategory", "Subcategory");

  return {
    delivery_date,
    city,
    city_id: cityIdNum != null ? Math.trunc(cityIdNum) : null,
    fsn_id: fsnRaw != null && String(fsnRaw).trim() !== "" ? String(fsnRaw).trim() : null,
    sku_id,
    sku_name: skuName != null ? String(skuName) : null,
    weight_unit: weightUnit != null && String(weightUnit).trim() !== ""
      ? String(weightUnit).trim()
      : null,
    cf: toFiniteNumber(rowGet(r, "CF", "cf")),
    bucket: bucket != null ? String(bucket) : null,
    subcategory: subcat != null ? String(subcat) : null,
    demand_units: toFiniteNumber(rowGet(r, "orderedlot", "demand_units", "OrderedLot")),
    demand_pct: toFiniteNumber(rowGet(r, "Mix", "demand_pct")),
    grn_price_per_kg: toFiniteNumber(rowGet(r, "t1_grn_qty", "T-1 GRN Qty", "grn_price_per_kg")),
    grn_price_per_unit: toFiniteNumber(rowGet(r, "t1_grn_unit", "T-1 GRN Unit", "grn_price_per_unit")),
    prev_grn_price_per_kg: toFiniteNumber(rowGet(r, "t2_grn_qty", "T-2 GRN Qty", "prev_grn_price_per_kg")),
    prev_grn_price_per_unit: toFiniteNumber(rowGet(r, "t2_grn_unit", "T-2 GRN Unit", "prev_grn_price_per_unit")),
    t3_grn_price_per_kg: toFiniteNumber(rowGet(r, "t3_grn_qty", "T-3 GRN Qty", "t3_grn_price_per_kg")),
    t3_grn_price_per_unit: toFiniteNumber(rowGet(r, "t3_grn_unit", "T-3 GRN Unit", "t3_grn_price_per_unit")),
  };
}

async function runDemandQuery(deliveryDate: string, city: string): Promise<Partial<PricingSheetRow>[]> {
  const sql = buildDemandSql(deliveryDate, city);
  // SaleOrder / PurchaseOrder / Weight live in asgard; cross-schema joins still use vormir/datalake.
  const rawRows = await withMysqlConnection(async (conn) => {
    // Heavy multi-join query — allow up to 3 minutes when the engine supports it.
    try {
      await conn.query("SET SESSION max_execution_time = 180000");
    } catch {
      // MariaDB / older MySQL may not support max_execution_time — ignore.
    }
    const [rows] = await conn.query(sql);
    return rows as Record<string, unknown>[];
  }, { database: "asgard" });

  const payload = rawRows
    .map((r) => mapDemandRowToSheet(r, deliveryDate, city))
    .filter((p): p is Partial<PricingSheetRow> => p != null);

  // Prefer MySQL FSN → WeightUnitName as weight_unit source of truth (same as demand CSV upload).
  const fsns = payload.map((p) => String(p.fsn_id ?? "").trim()).filter(Boolean);
  let weightMap: Record<string, string> = {};
  try {
    const lookup = await resolveFsnWeightUnitsForCity(fsns, city);
    weightMap = lookup.weightUnits;
  } catch (e) {
    console.warn(`MySQL weight-unit lookup failed for ${city}:`, e);
  }
  for (const p of payload) {
    const key = fsnWeightKey(String(p.fsn_id ?? ""));
    const fromMysql = weightMap[key];
    if (fromMysql) p.weight_unit = fromMysql;
  }

  return payload;
}

export const fetchDemandForPricingSheet = createServerFn({ method: "POST" })
  .validator(
    z.object({
      deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      city: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const rows = await runDemandQuery(data.deliveryDate, data.city);
    return { rows, count: rows.length };
  });

/** Client helper — calls the server fn. */
export async function loadDemandForPricingSheet(
  deliveryDate: string,
  city: string,
): Promise<Partial<PricingSheetRow>[]> {
  const result = await fetchDemandForPricingSheet({ data: { deliveryDate, city } });
  return result.rows;
}
