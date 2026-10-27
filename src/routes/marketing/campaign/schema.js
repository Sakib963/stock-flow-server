const Joi = require("joi");

const TYPES = ["InfluencerPost", "BoostedAd", "Seeding", "Live", "PageShare", "DiscountOffer"];
const STATUSES = ["Planned", "Live", "Completed", "Cancelled"];
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const day = Joi.date().iso().raw();
const money = Joi.number().integer().min(0).max(999999999999);

const campaign_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("posting_start", "campaign_no", "name", "created_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(STATUSES),
    promotion_type: one_or_more(TYPES),
    include: Joi.string().valid("", "stats").optional(),
});

const campaign_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const partners_for_campaign_schema = Joi.object({});

const batches_for_campaign_schema = Joi.object({
    search: Joi.string().trim().max(100).allow(null, "").optional(),
});

// The measuring window starts with the posting window; unless given, it ends 3 days after it (REQ-03).
const campaign_fields = {
    name: Joi.string().trim().min(1).max(255).required(),
    promotion_type: Joi.string().valid(...TYPES).required(),
    posting_start: day.required(),
    posting_end: day.min(Joi.ref("posting_start")).required(),
    measure_end: day.min(Joi.ref("posting_end")).allow(null).default(null),
    ad_spend: money.allow(null).default(null),
    other_cost: money.allow(null).default(null),
    other_cost_note: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
    note: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
    batches: Joi.array().items(Joi.string().uuid()).min(1).max(100).unique().required(),
    partners: Joi.array()
        .items(Joi.object({ partner_oid: Joi.string().uuid().required(), agreed_fee: money.required(), note: Joi.string().trim().max(500).allow(null, "").empty("").default(null) }))
        .max(50)
        .unique("partner_oid")
        .default([]),
};

// The oid is made by the client, so a save repeated after a lost answer finds the campaign it made.
const create_campaign_schema = Joi.object({ oid: Joi.string().uuid().required(), ...campaign_fields });

const update_campaign_schema = Joi.object({ oid: Joi.string().uuid().required(), version: Joi.string().pattern(/^\d+$/).required(), ...campaign_fields });

// One promised piece of work (REQ-11). Posted and Late carry the day it went up; the server fills
// today when none is given. Pending and Missed carry none.
const deliverable_fields = {
    kind: Joi.string().valid("Post", "Reel", "Story", "Live", "AdDays", "Other").required(),
    quantity: Joi.number().integer().min(1).max(365).default(1),
    due_on: day.required(),
    status: Joi.string().valid("Pending", "Posted", "Late", "Missed").default("Pending"),
    link: Joi.string().trim().uri({ scheme: ["http", "https"] }).max(500).allow(null, "").empty("").default(null),
    posted_on: day.allow(null).default(null),
    note: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
};

const create_deliverable_schema = Joi.object({ oid: Joi.string().uuid().required(), campaign_partner_oid: Joi.string().uuid().required(), ...deliverable_fields });

const update_deliverable_schema = Joi.object({ oid: Joi.string().uuid().required(), version: Joi.string().pattern(/^\d+$/).required(), ...deliverable_fields });

const deliverable_oid_schema = Joi.object({ oid: Joi.string().uuid().required() });

const cancel_campaign_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    note: Joi.string().trim().min(3).max(500).required(),
});

module.exports = { campaign_list_schema, campaign_oid_schema, partners_for_campaign_schema, batches_for_campaign_schema, create_campaign_schema, update_campaign_schema, cancel_campaign_schema, create_deliverable_schema, update_deliverable_schema, deliverable_oid_schema };
