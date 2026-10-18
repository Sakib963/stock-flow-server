const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.ADMIN + SUB_CONTEXTS.FEATURE;
const LIST = BASE + ROUTES.GET_FEATURE_LIST;
const TREE = BASE + ROUTES.GET_FEATURE_TREE;
const DETAILS = BASE + ROUTES.GET_FEATURE_DETAILS;
const UPDATE = BASE + ROUTES.UPDATE_FEATURE_DETAILS;
const SWITCH = BASE + ROUTES.SWITCH_FEATURE;
const REORDER = BASE + ROUTES.REORDER_FEATURES;
const PARTNERS = CONTEXTS.MARKETING + SUB_CONTEXTS.PARTNER + ROUTES.GET_PARTNER_LIST;
const PAY = CONTEXTS.MARKETING + SUB_CONTEXTS.PARTNER_PAYMENT + ROUTES.CREATE_PARTNER_PAYMENT;
const ADMIN = ["system.feature.view", "system.feature.edit"];

before(h.start);
after(h.stop);

const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `admin-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;
const get = (route, token) => h.call(route, { method: "GET", token });
const oid_of = async (where, values) => (await h.query(`SELECT oid FROM menu_item WHERE ${where}`, values))[0].oid;
const menu_entry = (menu, code) => menu.flatMap((m) => [m, ...m.children]).find((m) => m.permission === code);

// The menu is seed data the other test files read, so every test puts it back as it found it.
let snapshot;

describe("the feature registry", () => {
    before(async () => {
        snapshot = await h.query("SELECT oid, label, label_bn, description_en, description_bn, tags, is_new, status, is_disabled, disabled_message_en, disabled_message_bn, sort_order FROM menu_item");
    });
    // The registry page is switched on by its migration; the test database may predate it.
    beforeEach(async () => {
        await h.reset();
        await h.query("UPDATE menu_item SET is_disabled = false, disabled_message_en = NULL, disabled_message_bn = NULL WHERE permission_code = 'system.feature.view'");
        await h.query("UPDATE config_version SET version = version + 1");
    });
    afterEach(async () => {
        for (const r of snapshot) {
            await h.query("UPDATE menu_item SET label = $2, label_bn = $3, description_en = $4, description_bn = $5, tags = $6, is_new = $7, status = $8, is_disabled = $9, disabled_message_en = $10, disabled_message_bn = $11, sort_order = $12 WHERE oid = $1", [r.oid, r.label, r.label_bn, r.description_en, r.description_bn, r.tags, r.is_new, r.status, r.is_disabled, r.disabled_message_en, r.disabled_message_bn, r.sort_order]);
        }
        await h.query("UPDATE config_version SET version = version + 1");
    });

    it("is closed to someone who may not see it, and its changes to someone who may only look", async () => {
        const outsider = await sign_in_with(["marketing.partner.view"]);
        assert.equal((await get(`${LIST}?limit=50`, outsider)).status, 403);
        assert.equal((await get(TREE, outsider)).status, 403);
        const viewer = await sign_in_with(["system.feature.view"]);
        assert.equal((await get(`${LIST}?limit=50`, viewer)).status, 200);
        const partners = await oid_of("permission_code = 'marketing.partner.view'");
        assert.equal((await h.call(SWITCH, { token: viewer, body: { oid: partners, state: "Hidden" } })).status, 403);
    });

    it("lists every module and feature in menu order, with how many are on, disabled and hidden", async () => {
        const res = await get(`${LIST}?limit=100&include=stats`, await sign_in_with(ADMIN));
        const { rows, stats } = res.body.data;
        assert.equal(rows.length, (await h.query("SELECT COUNT(*)::int AS n FROM menu_item"))[0].n);
        assert.equal(rows[0].kind, rows[0].route ? "Feature" : "Module");
        assert.equal(stats.on + stats.disabled + stats.hidden, rows.length);
    });

    it("disables a feature for everyone, its admin included, shows it greyed with the reason, and turns it back on", async () => {
        const admin = await sign_in_with([...ADMIN, "marketing.partner.view"]);
        const partners = await oid_of("permission_code = 'marketing.partner.view'");
        assert.equal((await get(`${PARTNERS}?limit=5`, admin)).status, 200);

        const off = await h.call(SWITCH, { token: admin, body: { oid: partners, state: "Disabled", reason_en: "Being rebuilt", reason_bn: "নতুন করে তৈরি হচ্ছে" } });
        assert.equal(off.status, 200);
        const refused = await get(`${PARTNERS}?limit=5`, admin);
        assert.deepEqual([refused.status, refused.body.message, refused.body.data.switched_off], [403, "Being rebuilt", true]);
        const entry = menu_entry((await get(h.ROUTE.ME, admin)).body.data.menu, "marketing.partner.view");
        assert.deepEqual([entry.isDisabled, entry.disabledMessage.bn], [true, "নতুন করে তৈরি হচ্ছে"]);

        await h.call(SWITCH, { token: admin, body: { oid: partners, state: "On" } });
        assert.equal((await get(`${PARTNERS}?limit=5`, admin)).status, 200);
    });

    it("hides a whole module: gone from the menu and every feature in it refused", async () => {
        const admin = await sign_in_with([...ADMIN, "marketing.partner.view", "marketing.partner-payment.create"]);
        const marketing = await oid_of("slug = 'marketing'");
        assert.equal((await h.call(SWITCH, { token: admin, body: { oid: marketing, state: "Hidden" } })).status, 200);
        assert.equal(menu_entry((await get(h.ROUTE.ME, admin)).body.data.menu, "marketing.partner.view"), undefined);
        const refused = await get(`${PARTNERS}?limit=5`, admin);
        assert.deepEqual([refused.status, refused.body.message], [403, "This feature is not available."]);
        const [row] = (await get(`${LIST}?limit=100&state=Hidden`, admin)).body.data.rows.filter((r) => r.permission_code === "marketing.partner.view");
        assert.equal(row.state, "Hidden", "a feature in a hidden module is hidden with it");
        const pay = await h.call(PAY, { token: admin, body: {} });
        assert.deepEqual([pay.status, pay.body.data?.switched_off], [403, true], "a code with no menu entry of its own goes with its module");
    });

    it("never turns off the registry or the module it sits in, where features are turned back on", async () => {
        const admin = await sign_in_with(ADMIN);
        const registry = await oid_of("permission_code = 'system.feature.view'");
        const res = await h.call(SWITCH, { token: admin, body: { oid: registry, state: "Hidden" } });
        assert.equal(res.status, 409);
        const module = (await h.query("SELECT parent_oid FROM menu_item WHERE permission_code = 'system.feature.view'"))[0].parent_oid;
        assert.equal((await h.call(SWITCH, { token: admin, body: { oid: module, state: "Disabled", reason_en: "x", reason_bn: "x" } })).status, 409);
    });

    it("asks for the reason in both languages before disabling", async () => {
        const admin = await sign_in_with(ADMIN);
        const partners = await oid_of("permission_code = 'marketing.partner.view'");
        assert.equal((await h.call(SWITCH, { token: admin, body: { oid: partners, state: "Disabled", reason_en: "Being rebuilt" } })).status, 400);
    });

    it("renames a feature in the menu everyone sees at once, records the change, and writes nothing when nothing changed", async () => {
        const admin = await sign_in_with([...ADMIN, "marketing.partner.view"]);
        const partners = await oid_of("permission_code = 'marketing.partner.view'");
        const { details } = (await get(`${DETAILS}/${partners}`, admin)).body.data;
        const version = (await h.query("SELECT version FROM config_version"))[0].version;
        const same = { oid: partners, label: details.label, label_bn: details.label_bn, description_en: details.description_en, description_bn: details.description_bn, tags: details.tags, is_new: details.is_new };

        assert.equal((await h.call(UPDATE, { token: admin, body: same })).body.data.changed, false);
        const saved = await h.call(UPDATE, { token: admin, body: { ...same, label: "Influencers" } });
        assert.equal(saved.body.data.changed, true);
        assert.ok((await h.query("SELECT version FROM config_version"))[0].version > version, "every open tab reloads the menu");
        assert.equal(menu_entry((await get(h.ROUTE.ME, admin)).body.data.menu, "marketing.partner.view").label.en, "Influencers");
        const [log] = (await get(`${DETAILS}/${partners}`, admin)).body.data.activity;
        assert.match(log.description, /English label changed from ".*" to "Influencers"/);
    });

    it("gives the whole tree with every action, for the Feature tree drawer", async () => {
        const admin = await sign_in_with([...ADMIN, "sales.pos.view", "sales.pos.create"]);
        const { features, actions } = (await get(TREE, admin)).body.data;
        assert.equal(features.length, (await h.query("SELECT COUNT(*)::int AS n FROM menu_item"))[0].n);
        assert.ok(features.every((f) => !f.parent_oid || features.some((p) => p.oid === f.parent_oid)), "every feature's module is in the tree");
        assert.ok(actions.some((a) => a.code === "sales.pos.create" && a.action === "create"));
    });

    it("shows a feature's actions with the roles that hold each", async () => {
        const admin = await sign_in_with([...ADMIN, "marketing.partner.view"]);
        const partners = await oid_of("permission_code = 'marketing.partner.view'");
        const { actions } = (await get(`${DETAILS}/${partners}`, admin)).body.data;
        assert.equal(actions.find((a) => a.code === "marketing.partner.view").roles.length, 1);
    });

    it("reorders a module's features, and the menu follows on the next request", async () => {
        const admin = await sign_in_with([...ADMIN, "marketing.partner.view", "marketing.campaign.view"]);
        const marketing = await oid_of("slug = 'marketing'");
        const children = await h.query("SELECT oid FROM menu_item WHERE parent_oid = $1 ORDER BY sort_order", [marketing]);
        const reversed = children.map((c) => c.oid).reverse();
        const before = (await h.query("SELECT version FROM config_version"))[0].version;

        const res = await h.call(REORDER, { token: admin, body: { groups: [{ parent_oid: marketing, oids: reversed }] } });
        assert.deepEqual([res.status, res.body.data.changed], [200, true]);
        assert.ok((await h.query("SELECT version FROM config_version"))[0].version > before);
        const menu = (await get(h.ROUTE.ME, admin)).body.data.menu.find((m) => m.children.some((c) => c.permission === "marketing.partner.view"));
        const shown = menu.children.map((c) => c.permission);
        assert.ok(shown.indexOf("marketing.campaign.view") < shown.indexOf("marketing.partner.view"), shown.join(", "));
        assert.equal((await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [marketing]))[0].title, "Reordered the menu");

        const again = await h.call(REORDER, { token: admin, body: { groups: [{ parent_oid: marketing, oids: reversed }] } });
        assert.equal(again.body.data.changed, false);
    });

    it("refuses an order that moves a feature to another module or leaves one out, and anyone who may only look", async () => {
        const admin = await sign_in_with(ADMIN);
        const marketing = await oid_of("slug = 'marketing'");
        const children = (await h.query("SELECT oid FROM menu_item WHERE parent_oid = $1 ORDER BY sort_order", [marketing])).map((c) => c.oid);
        const elsewhere = (await h.query("SELECT oid FROM menu_item WHERE parent_oid IS NOT NULL AND parent_oid <> $1 LIMIT 1", [marketing]))[0].oid;
        assert.equal((await h.call(REORDER, { token: admin, body: { groups: [{ parent_oid: marketing, oids: [...children, elsewhere] }] } })).status, 409);
        assert.equal((await h.call(REORDER, { token: admin, body: { groups: [{ parent_oid: marketing, oids: children.slice(1) }] } })).status, 409);
        const viewer = await sign_in_with(["system.feature.view"]);
        assert.equal((await h.call(REORDER, { token: viewer, body: { groups: [{ parent_oid: marketing, oids: children }] } })).status, 403);
    });
});
