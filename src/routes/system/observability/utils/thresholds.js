const THRESHOLDS = {
    list_sweeping_per_hour: 200,
    many_addresses_per_day: 3,
    refusals_per_15_minutes: 20,
    office_opens_hour: 6,
    office_closes_hour: 23,
};

// The database plan's storage limit; the database itself cannot report it.
const PLAN_BYTES = 5 * 1024 ** 3;

module.exports = { THRESHOLDS, PLAN_BYTES };
