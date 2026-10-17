// The sentences of the timing and people section (sales analytics REQ-142). A rate is claimed only
// over at least 20 parcels (REQ-134).
const { RATE_FLOOR, percent } = require("./order-flow-insight");

// Of every 100 at list price, how much was given as discount, and how many discounted lines went to the batch's limit.
const discount_insight = (discount) => {
    if (!discount || discount.list_price <= 0) return null;
    if (discount.discount <= 0) return { key: "no_discount", params: {} };
    const share = (discount.discount / discount.list_price) * 100;
    return { key: "discount_share", params: { share: share < 1 ? Math.round(share * 10) / 10 : Math.round(share), atLimit: discount.at_limit, discounted: discount.discounted_lines } };
};

// The person whose online orders came back most, among those who sent enough to rate.
const people_insight = (people) => {
    const rated = people.filter((p) => p.dispatched >= RATE_FLOOR).map((p) => ({ ...p, rate: percent(p.failed, p.dispatched) }));
    if (rated.length < 2) return null;
    rated.sort((a, b) => b.rate - a.rate);
    const [worst] = rated;
    const others = rated.slice(1).reduce((sum, p) => ({ dispatched: sum.dispatched + p.dispatched, failed: sum.failed + p.failed }), { dispatched: 0, failed: 0 });
    const rest = percent(others.failed, others.dispatched);
    if (worst.rate <= rest) return null;
    return { key: "people_refusal", params: { person: worst.name || worst.email, rate: worst.rate, rest } };
};

const team_insights = (team) => ({ discount: discount_insight(team.discount), people: people_insight(team.people) });

module.exports = { team_insights };
