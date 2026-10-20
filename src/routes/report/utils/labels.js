const { REASON_LABEL: DISPOSE_REASON } = require("../../inventory/product-dispose/utils/dispose-rules");
const { REASON_LABEL: ADJUSTMENT_REASON } = require("../../inventory/stock-adjustment/utils/adjustment-rules");

// The words a spreadsheet prints for a stored code, by column type. The screen translates the same
// codes itself, in both languages.
const LABELS = {
    channel: { POS: "Counter", ONLINE: "Online" },
    courier: { OwnRider: "Own rider" },
    gender: { Female: "Female", Male: "Male", not_given: "Not given", no_customer: "No customer (walk-in)" },
    age_band: { under_18: "Under 18", "18_24": "18 to 24", "25_34": "25 to 34", "35_44": "35 to 44", "45_plus": "45 and over", not_given: "Not given", no_customer: "No customer (walk-in)" },
    customer_status: { Active: "Active", Inactive: "Inactive" },
    campaign_status: { Planned: "Planned", Live: "Live", Completed: "Completed", Cancelled: "Cancelled" },
    pre_order_status: { Pending: "Pending", Confirmed: "Confirmed", Cancelled: "Cancelled" },
    payment_method: { cash: "Cash", bkash: "bKash", nagad: "Nagad", card: "Card", cod: "Cash on delivery", other: "Other" },
    payment_type: { COD: "Cash on delivery", ADVANCE: "Advance", PREPAID: "Prepaid" },
    payment_status: { unpaid: "Unpaid", partially_paid: "Partly paid", paid: "Paid", partially_refunded: "Partly refunded", refunded: "Refunded" },
    purchase_payment: { unpaid: "Unpaid", partially_paid: "Partly paid", paid: "Paid" },
    return_reason: { damaged_on_arrival: "Damaged on arrival", wrong_item: "Wrong item", size_or_fit: "Size or fit", changed_mind: "Changed mind", not_as_described: "Not as described", entered_by_mistake: "Entered by mistake", other: "Other" },
    batch_status: { ready_for_sale: "For sale", pending_pricing: "Waiting for a price", internal_use: "Internal use" },
    dispose_reason: DISPOSE_REASON,
    adjustment_reason: ADJUSTMENT_REASON,
    yes_no: { true: "Yes", false: "No" },
};

const label = (type, value) => LABELS[type]?.[value] ?? value;

module.exports = { LABELS, label };
