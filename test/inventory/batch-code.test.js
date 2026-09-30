const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { batch_code_of } = require("../../src/routes/inventory/purchase-order/utils/batch-code");

describe("a batch code", () => {
      it("never repeats, so a scanned label names exactly one product's batch", () => {
            const codes = new Set();
            for (let n = 1; n <= 200000; n++) codes.add(batch_code_of(n));
            assert.equal(codes.size, 200000);
      });

      it("reads as random characters, with no date and nothing that looks like a count", () => {
            assert.match(batch_code_of(6), /^B-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
            assert.notEqual(batch_code_of(6).slice(0, 6), batch_code_of(7).slice(0, 6));
      });

      it("never takes the shape of an old code, so a search cannot match one of those", () => {
            assert.doesNotMatch(batch_code_of(6), /^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{5}$/);
      });
});
