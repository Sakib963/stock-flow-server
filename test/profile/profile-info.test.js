const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PROFILE = CONTEXTS.PROFILE + SUB_CONTEXTS.PROFILE_INFO;
const READ = PROFILE + ROUTES.GET_PROFILE_INFO;
const UPDATE = PROFILE + ROUTES.UPDATE_PROFILE_INFO;
const SIGN = PROFILE + ROUTES.SIGN_PROFILE_PHOTO_UPLOAD;
const CLOUD = "stockflow-test";

before(h.start);
after(h.stop);

describe("a person's own profile", () => {
    let user;
    let token;
    beforeEach(async () => {
        await h.reset();
        process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
        process.env.CLOUDINARY_API_KEY = "key";
        process.env.CLOUDINARY_API_SECRET = "secret";
        user = await h.seed_user({ permissions: [] });
        token = (await h.sign_in(user)).access;
    });

    const save = (body) => h.call(UPDATE, { body: { name: "Nusrat Jahan", mobile_number: "01711000111", designation: "Store manager", photo: null, ...body }, token });

    it("reads and saves the person's own details, needing no permission", async () => {
        assert.equal((await h.call(READ, { method: "GET", token })).body.data.email, user.email);
        const res = await save({ photo: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/people/nusrat.jpg` });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual(res.body.data, { email: user.email, name: "Nusrat Jahan", mobile_number: "01711000111", designation: "Store manager", photo: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/people/nusrat.jpg` });
        const [row] = await h.query("SELECT edited_on FROM login WHERE email = $1", [user.email]);
        assert.ok(row.edited_on, "the session payload reloads on edited_on");
        const [log] = await h.query("SELECT title FROM activity_log WHERE reference_type = 'user'");
        assert.equal(log.title, "Profile updated");
    });

    it("never changes the email or the role, whatever is sent", async () => {
        assert.equal((await save({ email: "someone@else.test" })).status, 400);
        assert.equal((await save({ role: "System Admin" })).status, 400);
    });

    it("takes a photo only from our own people folder", async () => {
        assert.equal((await save({ photo: "https://example.com/me.jpg" })).status, 400);
        assert.equal((await save({ photo: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/products/kurti.jpg` })).status, 400);
    });

    it("refuses a name too short and a mobile that is not a number", async () => {
        assert.equal((await save({ name: "N" })).status, 400);
        assert.equal((await save({ mobile_number: "call me" })).status, 400);
    });

    it("signs a photo upload into the people folder only", async () => {
        const res = await h.call(SIGN, { body: {}, token });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.folder, "stockflow/people");
    });

    it("refuses all of it without a sign in", async () => {
        assert.equal((await h.call(READ, { method: "GET" })).status, 401);
        assert.equal((await h.call(UPDATE, { body: { name: "Nusrat" } })).status, 401);
    });
});
