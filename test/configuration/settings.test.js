const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { getSettings, invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const SETTINGS = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.SETTINGS;
const READ = SETTINGS + ROUTES.GET_SETTINGS;
const SAVE = SETTINGS + ROUTES.UPDATE_SETTINGS;
const SIGN = SETTINGS + ROUTES.SIGN_SETTINGS_LOGO_UPLOAD;
const CLOUD = "stockflow-test";

before(h.start);
after(h.stop);

const BODY = { name: "A boutique", logo_url: null, address: "House 5, Road 2, Dhaka", phone_primary: "01711000111", phone_secondary: null, website: "www.aboutique.test", facebook_url: "https://facebook.com/aboutique", instagram_url: null };

describe("business settings", () => {
    let owner;
    beforeEach(async () => {
        await h.reset();
        process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
        process.env.CLOUDINARY_API_KEY = "key";
        process.env.CLOUDINARY_API_SECRET = "secret";
        await h.query("TRUNCATE settings CASCADE");
        await h.query("INSERT INTO settings (oid, name, bin, tracker_template) VALUES ($1, 'Old name', 'BIN-1', 'classic')", [uuidv4()]);
        invalidateSettings();
        owner = (await h.sign_in(await h.seed_user({ email: "owner@arithmalabs.test", permissions: ["settings.business.view", "settings.business.edit"] }))).access;
    });

    it("saves only the fields on the page, leaving the rest of the row as it was", async () => {
        const res = await h.call(SAVE, { body: BODY, token: owner });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.website, "https://www.aboutique.test", "an address typed without https:// gets it");
        const [row] = await h.query("SELECT name, address, bin, tracker_template FROM settings");
        assert.deepEqual(row, { name: "A boutique", address: "House 5, Road 2, Dhaka", bin: "BIN-1", tracker_template: "classic" });
        const [log] = await h.query("SELECT title FROM activity_log WHERE reference_type = 'settings'");
        assert.equal(log.title, "Business settings updated");
    });

    it("reaches every session: the version moves, the boot payload's ETag changes, and it carries the new name", async () => {
        const before_me = await h.call(h.ROUTE.ME, { method: "GET", token: owner });
        const before_read = await h.call(READ, { method: "GET", token: owner });
        assert.ok(before_read.config_version, "every guarded answer names the config version");
        assert.equal((await h.call(SAVE, { body: BODY, token: owner })).status, 200);
        const after_me = await h.call(h.ROUTE.ME, { method: "GET", token: owner });
        assert.equal(Number(after_me.config_version), Number(before_read.config_version) + 1);
        assert.notEqual(after_me.etag, before_me.etag, "a tab holding the old payload cannot get a 304");
        assert.equal(after_me.body.data.business.name, "A boutique");
        assert.equal(after_me.body.data.business.website, "https://www.aboutique.test");
    });

    it("drops another server instance's cached copy once the version has moved", async () => {
        assert.equal((await getSettings()).name, "Old name");
        // Another instance saved: the row and the version changed, this instance was never told.
        await h.query("UPDATE settings SET name = 'Saved elsewhere'");
        await h.query("UPDATE config_version SET version = version + 1");
        assert.equal((await getSettings()).name, "Saved elsewhere");
    });

    it("takes a logo only from our own branding folder", async () => {
        assert.equal((await h.call(SAVE, { body: { ...BODY, logo_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/branding/logo.png` }, token: owner })).status, 200);
        assert.equal((await h.call(SAVE, { body: { ...BODY, logo_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/products/kurti.jpg` }, token: owner })).status, 400);
        assert.equal((await h.call(SAVE, { body: { ...BODY, logo_url: "https://example.com/logo.png" }, token: owner })).status, 400);
        assert.equal((await h.call(SIGN, { body: {}, token: owner })).body.data.folder, "stockflow/branding");
    });

    it("refuses a missing name and a web address that is not one", async () => {
        assert.equal((await h.call(SAVE, { body: { ...BODY, name: "" }, token: owner })).status, 400);
        assert.equal((await h.call(SAVE, { body: { ...BODY, website: "not a site" }, token: owner })).status, 400);
    });

    it("lets someone who may only look read the settings but not change them, and anyone else neither", async () => {
        const viewer = (await h.sign_in(await h.seed_user({ email: "viewer@arithmalabs.test", permissions: ["settings.business.view"] }))).access;
        assert.equal((await h.call(READ, { method: "GET", token: viewer })).status, 200);
        assert.equal((await h.call(SAVE, { body: BODY, token: viewer })).status, 403);
        const staff = (await h.sign_in(await h.seed_user({ email: "staff@arithmalabs.test", permissions: [] }))).access;
        assert.equal((await h.call(READ, { method: "GET", token: staff })).status, 403);
        assert.equal((await h.call(SAVE, { body: BODY, token: staff })).status, 403);
        assert.equal((await h.call(SIGN, { body: {}, token: staff })).status, 403);
        assert.equal((await h.query("SELECT name FROM settings"))[0].name, "Old name");
    });
});
