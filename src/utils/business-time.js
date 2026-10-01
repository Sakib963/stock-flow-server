const { TABLE } = require("./constant");
const { getSettings } = require("./settings-cache");

// Times are stored as UTC wall clock (timestamp without time zone) and never rewritten. Everything a
// person reads, and every "today" or "this month", follows the business's own clock in
// settings.time_zone, so partners in Dhaka and New York see the same 10:18 for the same sale
// (decided by the user, 2026-10-01). Moments travel to the browser as UTC; only days are cut here.
const FALLBACK_ZONE = "Asia/Dhaka";

// Read inside the query itself, so no query needs the zone passed in.
const ZONE = `COALESCE((SELECT time_zone FROM ${TABLE.SETTINGS} ORDER BY created_on LIMIT 1), '${FALLBACK_ZONE}')`;

/** The business's calendar day of a stored UTC time. */
const business_day = (column) => `((${column}) AT TIME ZONE 'UTC' AT TIME ZONE ${ZONE})::date`;

/** Today, on the business's calendar. */
const business_today = `(now() AT TIME ZONE ${ZONE})::date`;

/** The stored UTC time at which a business day (a date expression) begins, for range filters that keep their index. */
const business_day_start = (day) => `(((${day})::date)::timestamp AT TIME ZONE ${ZONE} AT TIME ZONE 'UTC')`;

/** The stored UTC time at which this business month began. */
const business_month_start = business_day_start(`date_trunc('month', ${business_today})`);

/** A document number, PO-2610-0001: the year and month are the business's, as the column default would give in UTC. */
const business_number = (prefix, sequence) => `('${prefix}-' || to_char(${business_today}, 'YYMM') || '-' || to_char(nextval('${sequence}'), 'FM9999990000'))`;

const business_zone = async () => (await getSettings())?.time_zone || FALLBACK_ZONE;

// "2026-10-01 10:18" in the business's zone, for spreadsheets and emails: the one place the server
// formats a moment, because a file has no browser to do it.
const format_business = (value, zone, { time = true } = {}) => {
      if (!value) return "";
      // A date column is already a calendar day: shifting its midnight would move it a day.
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const parts = Object.fromEntries(
            new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) })
                  .formatToParts(new Date(value))
                  .map((p) => [p.type, p.value])
      );
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      return time ? `${day} ${parts.hour}:${parts.minute}` : day;
};

/** The label a report prints so a reader abroad knows which clock its times are in. */
const zone_label = (zone) => {
      const offset = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
      return `Times in ${zone}${offset ? ` (${offset})` : ""}`;
};

module.exports = { business_day, business_today, business_day_start, business_month_start, business_number, business_zone, format_business, zone_label };
