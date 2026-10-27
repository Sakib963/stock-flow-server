const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const GUARDED = require("./support/stale-guarded");

const ROUTES = path.join(__dirname, "../src/routes");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const relative = (file) => path.relative(ROUTES, file).split(path.sep).join("/");

// Edits that refuse a stale form some other way, or would refuse for no reason under refuse_stale.
const EXEMPT = {
    "admin/role/controller/update-role.js": "compares its own edited_on version",
    "admin/user/controller/update-user.js": "compares its own edited_on version",
    "inventory/overview/controller/update-batch-budget.js": "every sale rewrites the batch row",
    "inventory/overview/controller/update-batch-pricing.js": "every sale rewrites the batch row",
    "inventory/purchase-order/controller/update-batch-expiry.js": "every sale rewrites the batch row",
};

// Each ROUTES key with the controller file that answers it, read from the routers.
const routed = () =>
    walk(ROUTES)
        .filter((file) => path.basename(file) === "route.js")
        .flatMap((file) => {
            const text = fs.readFileSync(file, "utf8");
            const handlers = {};
            for (const [, names, controller] of text.matchAll(/const \{?\s*([\w,\s]+?)\s*\}? = require\("\.\/controller\/([\w-]+)"\)/g)) {
                for (const name of names.split(",")) handlers[name.trim()] = `${relative(path.dirname(file))}/controller/${controller}.js`;
            }
            return [...text.matchAll(/router\.\w+\(\s*ROUTES\.(\w+),[\s\S]*?\],\s*(\w+)\s*\)/g)].map(([, key, handler]) => ({ key, controller: handlers[handler] }));
        });

describe("every edit refuses a form opened before someone else saved", () => {
    const edits = walk(ROUTES)
        .map(relative)
        .filter((file) => /\/controller\/update-[^/]+\.js$/.test(file) || file === "sales/online/controller/create-online-order.js");

    it("finds the edits", () => assert.ok(edits.length > 20));

    for (const file of edits.filter((f) => !EXEMPT[f])) {
        it(file, () => assert.match(fs.readFileSync(path.join(ROUTES, file), "utf8"), /refuse_stale\(tx,/));
    }

    it("gives every guarded edit route the harness's stale check", () => {
        const guarded = routed().filter(({ key, controller }) => /^(UPDATE|EDIT)_/.test(key) && controller && !EXEMPT[controller] && /refuse_stale\(tx,/.test(fs.readFileSync(path.join(ROUTES, controller), "utf8")));
        assert.ok(guarded.length >= 20, `read ${guarded.length} guarded routes`);
        assert.deepEqual(guarded.map(({ key }) => key).filter((key) => !GUARDED[key]), []);
    });
});
