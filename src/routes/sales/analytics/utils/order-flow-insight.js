// The sentences of the online orders section (sales analytics REQ-142). A param ending in Key is a
// copy key the web translates; a place travels in both languages. A rate is only claimed over at
// least 20 parcels (REQ-134): below that the section has no sentence rather than a guess.
const RATE_FLOOR = 20;

const percent = (part, whole) => Math.round((part / whole) * 100);
const place = (row) => ({ en: row.name_en, bn: row.name_bn });

// Where most of the placed orders were lost, counting only the ones that are over, never still open.
const funnel_insight = (funnel) => {
    if (!funnel || funnel.placed === 0) return null;
    const losses = [
        ["confirm", funnel.placed - funnel.confirmed - funnel.waiting_confirm],
        ["dispatch", funnel.confirmed - funnel.dispatched - funnel.waiting_dispatch],
        ["deliver", funnel.dispatched - funnel.delivered - funnel.with_courier],
        ["keep", funnel.returned],
    ];
    const [step, lost] = losses.reduce((worst, next) => (next[1] > worst[1] ? next : worst));
    if (lost <= 0) return { key: "funnel_clean", params: { placed: funnel.placed } };
    return { key: `funnel_leak_${step}`, params: { lost, placed: funnel.placed } };
};

const rated = (rows) => rows.filter((row) => row.dispatched >= RATE_FLOOR).map((row) => ({ ...row, rate: percent(row.failed, row.dispatched) }));

const confirm_insight = (confirming) => {
    const rows = rated(confirming).sort((a, b) => a.rate - b.rate);
    if (rows.length < 2 || rows[0].rate === rows.at(-1).rate) return null;
    const best = rows[0];
    const worst = rows.at(-1);
    return { key: "confirm_compare", params: { bestKey: `sales.order.confirmedVia.${best.method}`, bestRate: best.rate, worstKey: `sales.order.confirmedVia.${worst.method}`, worstRate: worst.rate } };
};

const terms_insight = (terms) => {
    const cod = rated(terms.filter((t) => t.terms === "COD"))[0];
    const paid = terms.filter((t) => t.terms !== "COD").reduce((sum, t) => ({ dispatched: sum.dispatched + t.dispatched, failed: sum.failed + t.failed }), { dispatched: 0, failed: 0 });
    if (!cod || paid.dispatched < RATE_FLOOR) return null;
    return { key: "terms_compare", params: { codRate: cod.rate, advanceRate: percent(paid.failed, paid.dispatched) } };
};

const place_insight = (places) => {
    const worst = rated(places).sort((a, b) => b.rate - a.rate)[0];
    if (!worst || worst.failed === 0) return null;
    return { key: "place_refusal", params: { place: place(worst), failed: worst.failed, dispatched: worst.dispatched } };
};

// Warned is a flag, or a customer who received less than 80% of their earlier parcels.
const risk_insight = (risk) => {
    const sum = (names) => risk.filter((r) => names.includes(r.shown)).reduce((total, r) => ({ ended: total.ended + r.kept + r.failed, failed: total.failed + r.failed }), { ended: 0, failed: 0 });
    const warned = sum(["blocked", "watch", "under_80"]);
    const clear = sum(["from_80", "no_history"]);
    if (warned.ended < RATE_FLOOR || clear.ended < RATE_FLOOR) return null;
    return { key: "risk_compare", params: { warnedRate: percent(warned.failed, warned.ended), clearRate: percent(clear.failed, clear.ended) } };
};

const order_flow_insights = (flow) => ({
    funnel: funnel_insight(flow.funnel),
    confirming: confirm_insight(flow.confirming),
    terms: terms_insight(flow.terms),
    places: place_insight(flow.places),
    risk: risk_insight(flow.risk),
});

module.exports = { order_flow_insights, RATE_FLOOR, percent };
