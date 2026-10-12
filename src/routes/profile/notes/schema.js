const Joi = require("joi");

// The fixed set the app draws, each with its own colour; the table's CHECK holds the same list.
const NOTE_TAGS = ["important", "todo", "follow_up", "call_back", "supplier", "customer", "order", "stock", "payment", "delivery", "return", "price", "idea", "reminder", "meeting", "personal", "done"];

// note_title and note_text rather than title and content: both are on the request log's redaction
// list, so what a person writes for themselves never lands in a log someone else reads.
const note = {
    oid: Joi.string().uuid().required(),
    note_title: Joi.string().trim().max(256).allow(null, "").empty("").default(null),
    note_text: Joi.string().trim().max(10000).allow(null, "").empty("").default(null),
    // Optional: none is stored as null, never as an empty list.
    tags: Joi.array()
        .items(Joi.string().valid(...NOTE_TAGS))
        .unique()
        .allow(null)
        .default(null)
        .custom((value) => (value && value.length ? value : null)),
};

// Checked after trimming, so a note of spaces is as empty as no note.
const not_empty = (value, helpers) => (value.note_title || value.note_text ? value : helpers.message("Write a title or some text."));

const note_list_schema = Joi.object({});

// The oid is made by the client, so a save repeated after a lost answer finds the note it made.
const create_note_schema = Joi.object(note).custom(not_empty);

const update_note_schema = Joi.object(note).custom(not_empty);

const note_oid_schema = Joi.object({ oid: Joi.string().uuid().required() });

module.exports = { note_list_schema, create_note_schema, update_note_schema, note_oid_schema };
