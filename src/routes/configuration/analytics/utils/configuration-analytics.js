const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_month_start } = require("../../../../utils/business-time");

// How the catalogue is set up, never how it sells: nothing here reads orders, and stock is read only
// to say where it is (an aisle with nothing on it, how full a warehouse is).
//
// Every section belongs to one configuration feature and is left out for a caller who cannot view
// that feature, so the page never shows a name the person could not open.

const PRODUCT_LIVE = "is_deleted = FALSE AND status = 'Active'";

const COUNTS = [
      { key: "product", permission: "configuration.product.view", table: TABLE.PRODUCT, active: PRODUCT_LIVE, all: "is_deleted = FALSE" },
      { key: "category", permission: "configuration.category.view", table: TABLE.CATEGORIES },
      { key: "subCategory", permission: "configuration.sub-category.view", table: TABLE.SUB_CATEGORIES },
      { key: "brand", permission: "configuration.brands.view", table: TABLE.BRANDS },
      { key: "supplier", permission: "configuration.supplier.view", table: TABLE.SUPPLIER },
      { key: "warehouse", permission: "configuration.warehouse.view", table: TABLE.WAREHOUSE },
      { key: "aisle", permission: "configuration.aisle.view", table: TABLE.AISLE },
];

const count_sql = ({ table, active = "status = 'Active'", all = "TRUE" }) => `
      SELECT COUNT(*) FILTER (WHERE ${active})::int AS active,
             COUNT(*) FILTER (WHERE ${all} AND created_on >= ${business_month_start})::int AS added
      FROM ${table}`;

// Each check is a list of records someone can fix, named so the page can link to each one.
const ATTENTION = [
      {
            key: "productsWithoutPhoto",
            permission: "configuration.product.view",
            sql: `SELECT oid, name, NULL AS detail FROM ${TABLE.PRODUCT} WHERE ${PRODUCT_LIVE} AND COALESCE(TRIM(photo), '') = ''`,
      },
      {
            key: "productsWithoutBrand",
            permission: "configuration.product.view",
            sql: `SELECT oid, name, NULL AS detail FROM ${TABLE.PRODUCT} WHERE ${PRODUCT_LIVE} AND brand_oid IS NULL`,
      },
      {
            // A threshold of 0 means the product is never low until it is gone.
            key: "productsWithoutThreshold",
            permission: "configuration.product.view",
            sql: `SELECT oid, name, NULL AS detail FROM ${TABLE.PRODUCT} WHERE ${PRODUCT_LIVE} AND restock_threshold = 0`,
      },
      {
            key: "emptyCategories",
            permission: "configuration.category.view",
            sql: `SELECT c.oid, c.name, NULL AS detail FROM ${TABLE.CATEGORIES} c
                  WHERE c.status = 'Active' AND NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.category_oid = c.oid AND p.is_deleted = FALSE)`,
      },
      {
            key: "emptySubCategories",
            permission: "configuration.sub-category.view",
            sql: `SELECT s.oid, s.name, c.name AS detail FROM ${TABLE.SUB_CATEGORIES} s JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid
                  WHERE s.status = 'Active' AND NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.sub_category_oid = s.oid AND p.is_deleted = FALSE)`,
      },
      {
            key: "emptyBrands",
            permission: "configuration.brands.view",
            sql: `SELECT b.oid, b.name, NULL AS detail FROM ${TABLE.BRANDS} b
                  WHERE b.status = 'Active' AND NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.brand_oid = b.oid AND p.is_deleted = FALSE)`,
      },
      {
            // A batch is where its purchase order line was received; nothing moves stock between aisles yet.
            key: "emptyAisles",
            permission: "configuration.aisle.view",
            sql: `SELECT a.oid, a.name, w.name AS detail FROM ${TABLE.AISLE} a JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
                  WHERE a.status = 'Active' AND NOT EXISTS (
                        SELECT 1 FROM ${TABLE.INVENTORY} i
                        WHERE i.aisle_oid = a.oid AND i.quantity_available > 0)`,
      },
      {
            // Bought from means units received on a verified purchase order: a submitted one may still be cancelled,
            // and a line verified at 0 is something the supplier never sent.
            key: "suppliersNeverBoughtFrom",
            permission: "configuration.supplier.view",
            sql: `SELECT s.oid, s.name, NULL AS detail FROM ${TABLE.SUPPLIER} s
                  WHERE s.status = 'Active' AND NOT EXISTS (
                        SELECT 1 FROM ${TABLE.PURCHASE} pu JOIN ${TABLE.PURCHASE_DETAILS} d ON d.purchase_oid = pu.oid
                        WHERE pu.supplier_oid = s.oid AND pu.status = 'Verified' AND d.verified_quantity > 0)`,
      },
      {
            // Inactive hides the category from pickers while its active products carry on being sold under it.
            key: "inactiveCategoriesInUse",
            permission: "configuration.category.view",
            sql: `SELECT c.oid, c.name, NULL AS detail FROM ${TABLE.CATEGORIES} c
                  WHERE c.status = 'Inactive' AND EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.category_oid = c.oid AND p.is_deleted = FALSE AND p.status = 'Active')`,
      },
      {
            key: "inactiveBrandsInUse",
            permission: "configuration.brands.view",
            sql: `SELECT b.oid, b.name, NULL AS detail FROM ${TABLE.BRANDS} b
                  WHERE b.status = 'Inactive' AND EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.brand_oid = b.oid AND p.is_deleted = FALSE AND p.status = 'Active')`,
      },
];

const ATTENTION_SHOWN = 5;

const attention_sql = (sql) => `SELECT oid, name, detail, COUNT(*) OVER ()::int AS total FROM (${sql}) t ORDER BY name LIMIT ${ATTENTION_SHOWN}`;

// Active products per group. A product is in one category and at most one brand, so those shares add
// up to the whole; it can be bought from several suppliers, so a supplier's share is of the products
// ever bought and the shares overlap.
const SPREAD = [
      {
            key: "category",
            permission: "configuration.category.view",
            sql: `SELECT c.oid, c.name, COUNT(*)::int AS products FROM ${TABLE.PRODUCT} p JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
                  WHERE p.is_deleted = FALSE AND p.status = 'Active' GROUP BY c.oid, c.name`,
            total: `SELECT COUNT(*)::int AS total FROM ${TABLE.PRODUCT} WHERE ${PRODUCT_LIVE}`,
      },
      {
            key: "brand",
            permission: "configuration.brands.view",
            sql: `SELECT b.oid, b.name, COUNT(*)::int AS products FROM ${TABLE.PRODUCT} p LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
                  WHERE p.is_deleted = FALSE AND p.status = 'Active' GROUP BY b.oid, b.name`,
            total: `SELECT COUNT(*)::int AS total FROM ${TABLE.PRODUCT} WHERE ${PRODUCT_LIVE}`,
      },
      {
            key: "supplier",
            permission: "configuration.supplier.view",
            overlaps: true,
            sql: `SELECT s.oid, s.name, COUNT(DISTINCT p.oid)::int AS products FROM ${TABLE.PURCHASE} pu
                  JOIN ${TABLE.SUPPLIER} s ON s.oid = pu.supplier_oid
                  JOIN ${TABLE.PURCHASE_DETAILS} d ON d.purchase_oid = pu.oid AND d.verified_quantity > 0
                  JOIN ${TABLE.PRODUCT} p ON p.oid = d.product_oid AND p.is_deleted = FALSE AND p.status = 'Active'
                  WHERE pu.status = 'Verified' GROUP BY s.oid, s.name`,
            total: `SELECT COUNT(DISTINCT p.oid)::int AS total FROM ${TABLE.PURCHASE} pu
                    JOIN ${TABLE.PURCHASE_DETAILS} d ON d.purchase_oid = pu.oid AND d.verified_quantity > 0
                    JOIN ${TABLE.PRODUCT} p ON p.oid = d.product_oid AND p.is_deleted = FALSE AND p.status = 'Active'
                    WHERE pu.status = 'Verified'`,
      },
];

const SPREAD_SHOWN = 8;

const WAREHOUSE_FULLNESS_SQL = `
      SELECT w.oid, w.name, w.capacity_units AS capacity, COALESCE(SUM(i.quantity_available), 0)::int AS on_hand
      FROM ${TABLE.WAREHOUSE} w
      LEFT JOIN ${TABLE.INVENTORY} i ON i.warehouse_oid = w.oid
      WHERE w.status = 'Active'
      GROUP BY w.oid, w.name, w.capacity_units
      ORDER BY w.name`;

const ACTIVITY_TYPES = {
      category: "configuration.category.view",
      "sub-category": "configuration.sub-category.view",
      brand: "configuration.brands.view",
      supplier: "configuration.supplier.view",
      product: "configuration.product.view",
      warehouse: "configuration.warehouse.view",
      aisle: "configuration.aisle.view",
};

const ACTIVITY_SHOWN = 8;

const read_spread = async ({ sql, total, overlaps }) => {
      const [rows, [{ total: products }]] = await Promise.all([get_data({ text: `${sql} ORDER BY products DESC, name` }), get_data({ text: total })]);
      const shown = rows.slice(0, SPREAD_SHOWN);
      const rest = rows.slice(SPREAD_SHOWN);
      return {
            total: products,
            rows: shown.map((r) => ({ oid: r.oid, name: r.name, products: r.products })),
            other: overlaps || !rest.length ? null : { groups: rest.length, products: rest.reduce((sum, r) => sum + r.products, 0) },
      };
};

const read_activity = async (types) => {
      if (!types.length) return [];
      const rows = await get_data({
            text: `SELECT oid, reference_type, reference_oid, title, description, performed_by, performed_on
                   FROM ${TABLE.ACTIVITY_LOG} WHERE reference_type = ANY($1) ORDER BY performed_on DESC LIMIT ${ACTIVITY_SHOWN}`,
            values: [types],
      });
      return rows.map((a) => ({ oid: a.oid, type: a.reference_type, recordOid: a.reference_oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description }));
};

/** The configuration analytics page for a caller holding `held`, a Set of permission codes. */
const read_configuration_analytics = async (held) => {
      const counts = COUNTS.filter((c) => held.has(c.permission));
      const attention = ATTENTION.filter((a) => held.has(a.permission));
      const spread = SPREAD.filter((s) => held.has(s.permission));
      const warehouses = held.has("configuration.warehouse.view");

      const [count_rows, attention_rows, spread_rows, warehouse_rows, activity] = await Promise.all([
            Promise.all(counts.map((c) => get_data({ text: count_sql(c) }))),
            Promise.all(attention.map((a) => get_data({ text: attention_sql(a.sql) }))),
            Promise.all(spread.map(read_spread)),
            warehouses ? get_data({ text: WAREHOUSE_FULLNESS_SQL }) : null,
            read_activity(Object.keys(ACTIVITY_TYPES).filter((type) => held.has(ACTIVITY_TYPES[type]))),
      ]);

      return {
            counts: Object.fromEntries(counts.map((c, i) => [c.key, count_rows[i][0]])),
            attention: attention.map((a, i) => ({
                  key: a.key,
                  total: attention_rows[i][0]?.total ?? 0,
                  items: attention_rows[i].map((r) => ({ oid: r.oid, name: r.name, detail: r.detail })),
            })),
            spread: Object.fromEntries(spread.map((s, i) => [s.key, spread_rows[i]])),
            warehouses: warehouse_rows?.map((w) => ({ oid: w.oid, name: w.name, onHand: w.on_hand, capacity: w.capacity, fullRate: w.capacity ? Math.round((w.on_hand / w.capacity) * 1000) / 10 : null })) ?? null,
            activity,
      };
};

module.exports = { read_configuration_analytics };
