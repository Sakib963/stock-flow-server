// The sentences of the customers tab (sales analytics REQ-142).
const { RATE_FLOOR, percent } = require("./order-flow-insight");

// The district most online buyers live in, and its share of them.
const place_insight = (places) => {
    const total = places.reduce((sum, p) => sum + p.customers, 0);
    const top = places.reduce((best, p) => (!best || p.customers > best.customers ? p : best), null);
    if (!top || !top.customers) return null;
    return { key: "top_district", params: { place: { en: top.name_en, bn: top.name_bn }, share: percent(top.customers, total), count: top.customers } };
};

// How many came back, said only over enough customers to mean something (REQ-134).
const repeat_insight = (repeat) => {
    if (!repeat || !repeat.customers) return null;
    const returning = repeat.customers - repeat.new_customers;
    if (repeat.customers < RATE_FLOOR) return { key: "repeat_counts", params: { returning, customers: repeat.customers } };
    return { key: "repeat_rate", params: { rate: percent(returning, repeat.customers), customers: repeat.customers } };
};

const customers_insights = (figures) => ({ places: place_insight(figures.places), repeat: repeat_insight(figures.repeat) });

module.exports = { customers_insights };
