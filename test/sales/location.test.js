const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");
const { execute_transaction } = require("../../src/db/database");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { learn_area } = require("../../src/routes/sales/location/utils/learn-area");
const { invalidateSettings } = require("../../src/utils/settings-cache");

const BASE = CONTEXTS.SALES + SUB_CONTEXTS.LOCATION;
const MATCH = BASE + ROUTES.MATCH_LOCATION;
const SEARCH = BASE + ROUTES.SEARCH_LOCATION;

const DHAKA_MOHAMMADPUR = "BD-Thana-Dhaka-Mohammadpur";
const MAGURA_MOHAMMADPUR = "BD-Thana-Magura-Mohammadpur";
const DHAKA_ADABOR = "BD-Thana-Dhaka-Adabor";

before(h.start);
after(h.stop);

// The two Mohammadpurs of the requirements, a neighbour sharing 1207, a union, and spellings, in
// the shape tools/build-location-seed.js writes them.
const seed_places = async () => {
    await h.query("TRUNCATE location_alias, area, post_office, thana, district, division, online_order, orders, settings CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ'), ('BD-Khulna-Division', 'Khulna Division', 'খুলনা বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division'), ('BD-Magura', 'Magura', 'মাগুরা', 'BD-Khulna-Division')");
    await h.query(
        `INSERT INTO thana (oid, name_en, name_bn, type, postal_code, district_oid) VALUES
            ($1, 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', '1207', 'BD-Dhaka'),
            ($2, 'Adabor', 'আদাবর', 'Thana', '1207', 'BD-Dhaka'),
            ($3, 'Mohammadpur', 'মোহাম্মদপুর', 'Upazila', '7630', 'BD-Magura')`,
        [DHAKA_MOHAMMADPUR, DHAKA_ADABOR, MAGURA_MOHAMMADPUR]
    );
    await h.query("INSERT INTO post_office (oid, postal_code, name_en, name_bn, thana_oid) VALUES ('PO-1207', '1207', 'Mohammadpur Housing', 'মোহাম্মদপুর হাউজিং', $1), ('PO-7630', '7630', 'Mohammadpur', 'মোহাম্মদপুর', $2)", [DHAKA_MOHAMMADPUR, MAGURA_MOHAMMADPUR]);
    await h.query("INSERT INTO area (oid, thana_oid, name_en, name_bn, name_key, kind) VALUES ('U-Binodpur', $1, 'Binodpur Union', 'বিনোদপুর ইউনিয়ন', 'binodpurunion', 'Union'), ('U-Mohammadpur', $1, 'Mohammadpur', 'মোহাম্মদপুর', 'mohammadpur', 'Union')", [MAGURA_MOHAMMADPUR]);
    await h.query("INSERT INTO location_alias (oid, level, location_oid, alias, alias_key) VALUES ('A-1', 'Thana', $1, 'Mohammodpur', 'mohammodpur'), ('A-2', 'District', 'BD-Dhaka', 'Dacca', 'dacca')", [DHAKA_MOHAMMADPUR]);
    invalidateSettings();
    await reload_location_index();
};

let seq = 0;
const reader = async (permissions = ["sales.online.view"]) => {
    const user = await h.seed_user({ email: `moderator${++seq}@arithmalabs.test`, permissions });
    return (await h.sign_in(user)).access;
};

const match = async (token, text) => {
    const res = await h.call(MATCH, { body: { text }, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data;
};

const thana_ranks = (data) => data.candidates.map((c) => [c.thana?.oid ?? c.district.oid, c.rank]);

describe("reading a place from a pasted address", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await reader();
    });

    it("shows both Mohammadpurs as a tie on a new install with nothing else to go on", async () => {
        const data = await match(token, "person a, 5/5 gaznabi road, mohammadpur");
        assert.deepEqual(thana_ranks(data).sort(), [[DHAKA_MOHAMMADPUR, 1], [MAGURA_MOHAMMADPUR, 1]].sort());
    });

    it("puts the home district first when there are no orders yet", async () => {
        await h.query("INSERT INTO settings (oid, home_district_oid) VALUES ($1, 'BD-Dhaka')", [uuidv4()]);
        invalidateSettings();
        await reload_location_index();
        const data = await match(token, "gaznabi road, mohammadpur");
        assert.deepEqual(thana_ranks(data), [[DHAKA_MOHAMMADPUR, 1], [MAGURA_MOHAMMADPUR, 2]]);
        assert.deepEqual(data.candidates[0].reasons, ["common_district"]);
    });

    it("puts the district the business sends to most first", async () => {
        for (let i = 0; i < 2; i++) {
            const order_oid = uuidv4();
            await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status) VALUES ($1, $1, 0, 'ONLINE', 'Pending')", [order_oid]);
            await h.query("INSERT INTO online_order (order_oid, district_oid) VALUES ($1, 'BD-Magura')", [order_oid]);
        }
        await reload_location_index();
        const data = await match(token, "mohammadpur");
        assert.deepEqual(thana_ranks(data), [[MAGURA_MOHAMMADPUR, 1], [DHAKA_MOHAMMADPUR, 2]]);
    });

    it("lets a district named in the text settle it", async () => {
        const data = await match(token, "house 3, mohammadpur, magura");
        assert.equal(data.candidates[0].thana.oid, MAGURA_MOHAMMADPUR);
        assert.equal(data.candidates[0].rank, 1);
        assert.deepEqual(data.candidates[0].reasons, ["district"]);
        assert.equal(data.candidates[1].rank, 2);
    });

    it("lets a post code narrow the place to its district, over a district typed elsewhere", async () => {
        const data = await match(token, "mohammadpur 1207");
        assert.equal(data.postal_code, "1207");
        assert.deepEqual(thana_ranks(data), [[DHAKA_MOHAMMADPUR, 1]]);
        assert.deepEqual(data.candidates[0].reasons, ["postcode"]);
    });

    it("offers every thana a post code covers when no thana is named, Bengali digits included", async () => {
        const data = await match(token, "road 4, ১২০৭");
        assert.deepEqual(thana_ranks(data).sort(), [[DHAKA_ADABOR, 1], [DHAKA_MOHAMMADPUR, 1]].sort());
    });

    it("matches a common misspelling and the Bengali name to the same thana", async () => {
        const misspelt = await match(token, "mohammodpur");
        assert.deepEqual(thana_ranks(misspelt), [[DHAKA_MOHAMMADPUR, 1]]);
        const bengali = await match(token, "বাসা ৫, মোহাম্মদপুর, ঢাকা");
        assert.equal(bengali.candidates[0].thana.oid, DHAKA_MOHAMMADPUR);
        assert.deepEqual(bengali.candidates[0].reasons, ["district"]);
    });

    it("finds the upazila from a union when no thana is named", async () => {
        const data = await match(token, "village road, binodpur");
        assert.equal(data.candidates[0].thana.oid, MAGURA_MOHAMMADPUR);
        assert.equal(data.candidates[0].area.oid, "U-Binodpur");
    });

    it("offers the district alone when the text names a district and no thana", async () => {
        const data = await match(token, "somewhere in dacca");
        assert.equal(data.candidates.length, 1);
        assert.equal(data.candidates[0].district.oid, "BD-Dhaka");
        assert.equal(data.candidates[0].thana, null);
    });

    it("returns no candidates for text that names no place", async () => {
        const data = await match(token, "call before coming");
        assert.deepEqual(data.candidates, []);
    });
});

describe("learning an area from confirmed orders", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await reader();
    });

    it("ranks the thana an area was learned under first the next time", async () => {
        await execute_transaction((tx) => learn_area(tx, { thana_oid: DHAKA_MOHAMMADPUR, name: "Gaznabi  Road", user_id: "owner@arithmalabs.test" }));
        await reload_location_index();

        const data = await match(token, "person a, 5/5, gaznabi road, mohammadpur");
        assert.deepEqual(thana_ranks(data), [[DHAKA_MOHAMMADPUR, 1], [MAGURA_MOHAMMADPUR, 2]]);
        assert.deepEqual(data.candidates[0].reasons, ["area"]);
        assert.equal(data.candidates[0].area.name_en, "Gaznabi Road");
    });

    it("counts each use on one row, and counts a union rather than learning a twin of it", async () => {
        const first = await execute_transaction((tx) => learn_area(tx, { thana_oid: DHAKA_MOHAMMADPUR, name: "Gaznabi Road", user_id: "a@arithmalabs.test" }));
        const second = await execute_transaction((tx) => learn_area(tx, { thana_oid: DHAKA_MOHAMMADPUR, name: "gaznabi-road", user_id: "b@arithmalabs.test" }));
        assert.equal(first, second);
        const [learned] = await h.query("SELECT times_used, kind FROM area WHERE oid = $1", [first]);
        assert.deepEqual(learned, { times_used: 2, kind: "Learned" });

        const union = await execute_transaction((tx) => learn_area(tx, { thana_oid: MAGURA_MOHAMMADPUR, name: "Binodpur Union", user_id: "a@arithmalabs.test" }));
        assert.equal(union, "U-Binodpur");
        const [{ count }] = await h.query("SELECT COUNT(*)::int AS count FROM area WHERE thana_oid = $1 AND kind = 'Learned'", [MAGURA_MOHAMMADPUR]);
        assert.equal(count, 0);
    });

    it("counts two orders learning the same new area at once on one row", async () => {
        const learn = () => execute_transaction((tx) => learn_area(tx, { thana_oid: DHAKA_ADABOR, name: "Shekhertek", user_id: "a@arithmalabs.test" }));
        const [a, b] = await Promise.all([learn(), learn()]);
        assert.equal(a, b);
        const [row] = await h.query("SELECT times_used FROM area WHERE oid = $1", [a]);
        assert.equal(row.times_used, 2);
    });
});

describe("picking a district or thana by hand", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_places();
    });

    it("finds thanas by the start of a name, narrowed to a district", async () => {
        const token = await reader(["sales.customer.view"]);
        const all = await h.call(`${SEARCH}?level=Thana&search=moha`, { method: "GET", token });
        assert.equal(all.status, 200);
        assert.deepEqual(all.body.data.map((t) => t.oid).sort(), [DHAKA_MOHAMMADPUR, MAGURA_MOHAMMADPUR].sort());

        const dhaka = await h.call(`${SEARCH}?level=Thana&search=moha&district_oid=BD-Dhaka`, { method: "GET", token });
        assert.deepEqual(
            dhaka.body.data.map((t) => [t.oid, t.district.name_en]),
            [[DHAKA_MOHAMMADPUR, "Dhaka"]]
        );
    });

    it("finds a district by its other spelling and by its Bengali name", async () => {
        const token = await reader();
        const alias = await h.call(`${SEARCH}?level=District&search=dacc`, { method: "GET", token });
        assert.deepEqual(alias.body.data.map((d) => d.oid), ["BD-Dhaka"]);
        const bengali = await h.call(`${SEARCH}?level=District&search=${encodeURIComponent("মাগু")}`, { method: "GET", token });
        assert.deepEqual(bengali.body.data.map((d) => d.oid), ["BD-Magura"]);
    });

    it("refuses someone who neither sells nor sees customers", async () => {
        const token = await reader(["inventory.overview.view"]);
        const search = await h.call(`${SEARCH}?level=District&search=dh`, { method: "GET", token });
        assert.equal(search.status, 403);
        const read = await h.call(MATCH, { body: { text: "mohammadpur" }, token });
        assert.equal(read.status, 403);
    });
});
