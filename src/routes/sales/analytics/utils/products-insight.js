// The sentences of the products and suppliers tab (sales analytics REQ-142). A rate is claimed only
// over at least 20 units (REQ-134).
const { RATE_FLOOR, percent } = require("./order-flow-insight");

// The best seller's share of sales, or nothing when nothing sold.
const product_insight = (products, totals) => {
    const [top] = products;
    if (!top || !totals || totals.sales <= 0) return null;
    return { key: "top_product", params: { product: top.name, share: percent(top.sales, totals.sales) } };
};

// The product wanted most beyond what was kept: asked for at least 20 times, keeping under 70%.
const demand_insight = (products) => {
    const gaps = products.filter((p) => p.demand_units >= RATE_FLOOR && p.kept_units < p.demand_units * 0.7).sort((a, b) => b.demand_units - b.kept_units - (a.demand_units - a.kept_units));
    const [gap] = gaps;
    return gap ? { key: "demand_gap", params: { product: gap.name, demand: gap.demand_units, kept: gap.kept_units } } : null;
};

// The supplier whose goods come back most, among those with enough sold to rate.
const supplier_insight = (suppliers) => {
    const rated = suppliers.filter((s) => s.oid && s.sold_units >= RATE_FLOOR).map((s) => ({ ...s, rate: percent(s.returned_units, s.sold_units) }));
    if (rated.length < 2) return null;
    rated.sort((a, b) => b.rate - a.rate);
    const [worst] = rated;
    return worst.rate > 0 ? { key: "supplier_returns", params: { supplier: worst.name, rate: worst.rate } } : null;
};

// The largest group of buyers, by gender and age, among those whose gender and age were recorded.
const buyer_insight = (buyers) => {
    const total = buyers.reduce((sum, b) => sum + b.customers, 0);
    const known = buyers.filter((b) => b.gender && b.age_band);
    const knownCount = known.reduce((sum, b) => sum + b.customers, 0);
    if (!total) return null;
    if (!knownCount) return { key: "buyers_unknown", params: {} };
    const top = known.reduce((best, b) => (b.customers > best.customers ? b : best));
    return { key: "buyers_top", params: { genderKey: `sales.customer.gender.${top.gender}`, ageKey: `sales.customer.ageBand.${top.age_band}`, share: percent(top.customers, knownCount), known: percent(knownCount, total) } };
};

const products_insights = (figures) => ({
    products: product_insight(figures.products, figures.totals),
    demand: demand_insight(figures.products),
    suppliers: supplier_insight(figures.suppliers),
    buyers: buyer_insight(figures.buyers),
});

module.exports = { products_insights };
