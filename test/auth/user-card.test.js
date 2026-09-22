const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const { CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ROUTE = CONTEXTS.AUTH + ROUTES.GET_USER_CARD;

before(h.start);
after(h.stop);

const card = (token, params = {}) => h.call(`${ROUTE}?${new URLSearchParams(params)}`, { method: "GET", token });

describe("the person card", () => {
    let reader;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user();
        reader = (await h.sign_in(user)).access;
    });

    it("answers anyone signed in, because reading a colleague's card is not a power a role grants", async () => {
        const other = await h.seed_user({ email: "counter@samiha.test" });
        const { access } = await h.sign_in(other);

        const res = await card(access, { email: "counter@samiha.test" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.name, "Samiha Rahman");
    });

    it("refuses a request with no token as signed out, not as forbidden", async () => {
        const res = await card(undefined, { email: "owner@samiha.test" });
        assert.equal(res.status, 401);
    });

    it("answers with who the person is, and the role their role_oid actually grants", async () => {
        await h.query("UPDATE login SET designation = 'Shop owner' WHERE email = 'owner@samiha.test'");

        const res = await card(reader, { email: "owner@samiha.test" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.name, "Samiha Rahman");
        assert.equal(res.body.data.designation, "Shop owner");
        assert.equal(res.body.data.active, true);
        assert.match(res.body.data.role, /^Role /);
    });

    it("finds the person whatever case the row stored the address in", async () => {
        const res = await card(reader, { email: "OWNER@samiha.test" });

        assert.equal(res.body.data.name, "Samiha Rahman");
    });

    it("says an address with no account is not active rather than answering 404", async () => {
        const res = await card(reader, { email: "left@samiha.test" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.name, null);
        assert.equal(res.body.data.active, false);
        assert.equal(res.body.data.email, "left@samiha.test");
    });

    it("says a switched-off account is not active, so the card can show that it is closed", async () => {
        // A colleague's account, not the reader's own: turning that one off ends their session and
        // the request would be answered as signed out before it ever reached the card.
        await h.seed_user({ email: "gone@samiha.test", status: "Inactive" });

        const res = await card(reader, { email: "gone@samiha.test" });

        assert.equal(res.body.data.active, false);
        assert.equal(res.body.data.name, "Samiha Rahman");
    });

    it("refuses anything that is not an email, so nothing else can reach the query", async () => {
        const res = await card(reader, { email: "owner@samiha.test'; DROP TABLE login" });

        assert.equal(res.status, 400);
    });
});
