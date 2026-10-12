const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("./harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BATCH = CONTEXTS.SALES + SUB_CONTEXTS.DELIVERY_BATCH;
const DELIVERY = ["sales.delivery-batch.view", "sales.delivery-batch.create", "sales.delivery-batch.dispatch", "sales.delivery-batch.deliver"];

// A parcel leaves the shop only in a delivery batch: one batch of its own, handed to the courier.
const dispatch = async (token, order_oid, courier = "Pathao") => {
    const oid = uuidv4();
    const made = await h.call(BATCH + ROUTES.CREATE_DELIVERY_BATCH, { body: { oid, courier, order_oids: [order_oid] }, token });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const handed = await h.call(BATCH + ROUTES.HAND_OVER_DELIVERY_BATCH, { body: { oid }, token });
    assert.equal(handed.status, 200, JSON.stringify(handed.body));
    return oid;
};

/** Mark delivered from the batch the parcel left in. */
const deliver = async (token, order_oid) => {
    const [row] = await h.query("SELECT batch_oid FROM delivery_batch_order WHERE order_oid = $1 AND active ORDER BY created_on DESC LIMIT 1", [order_oid]);
    return h.call(BATCH + ROUTES.DELIVER_DELIVERY_BATCH, { body: { oid: row.batch_oid, order_oids: [order_oid] }, token });
};

module.exports = { DELIVERY, dispatch, deliver };
