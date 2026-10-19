const { get_data } = require("../../../db/database");
const { business_today } = require("../../../utils/business-time");

// The chosen days on the business's clock, and the same number of days just before them.
const START = {
    today: business_today,
    week: `${business_today} - 6`,
    month: `date_trunc('month', ${business_today})::date`,
};

const read_dashboard_period = async (key) =>
    (
        await get_data({
            text: `WITH chosen AS (SELECT ${START[key]} AS date_from, ${business_today} AS date_to)
                   SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to,
                          to_char(date_from - (date_to - date_from + 1), 'YYYY-MM-DD') AS previous_from, to_char(date_from - 1, 'YYYY-MM-DD') AS previous_to
                     FROM chosen`,
        })
    )[0];

module.exports = { read_dashboard_period, PERIODS: Object.keys(START) };
