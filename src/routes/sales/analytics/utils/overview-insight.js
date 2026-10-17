// The sentence above each chart (sales analytics REQ-142), sent as a key and its numbers so the web
// says it in the person's language.

// Under one in a hundred keeps a decimal, so a small discount never reads as nothing.
const per_hundred = (part, whole) => {
    const share = (part / whole) * 100;
    return share > 0 && share < 1 ? Math.round(share * 10) / 10 : Math.round(share);
};

const headline_insight = (current, previous) => {
    if (current.sales <= 0) return { key: "no_sales", params: {} };
    if (previous.sales <= 0) return { key: "no_previous", params: {} };
    const change = per_hundred(current.sales - previous.sales, previous.sales);
    if (change === 0) return { key: "sales_same", params: {} };
    return { key: change > 0 ? "sales_up" : "sales_down", params: { change: Math.abs(change) } };
};

// "Of every 100 at list price, 31 became profit; discounts took 8 and returns 5."
const waterfall_insight = (totals) => {
    if (totals.list_price <= 0) return null;
    return {
        key: "of_every_hundred",
        params: {
            profit: per_hundred(totals.sales - totals.cost, totals.list_price),
            discounts: per_hundred(totals.discounts, totals.list_price),
            returns: per_hundred(totals.returns, totals.list_price),
        },
    };
};

module.exports = { headline_insight, waterfall_insight };
