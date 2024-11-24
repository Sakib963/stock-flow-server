const pool = require('./db.config');
const log = require('./log');

const get_data = async (query) => {
    try {
        const res = await pool.query(query);
        return res.rows;
    } catch (e) {
        log.error("Unable to execute statement in database: ", e);
        throw e;
    }
};

const execute_value = async (query) => {
    try {
        await pool.query(query);
    } catch (e) {
        log.error("Unable to execute statement in database: ", e);
        throw e;
    }
};

const execute_values = async (query) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (let q of query) await client.query(q);
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        log.error("Unable to execute statement in database: ", e);
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    get_data,
    execute_value,
    execute_values,
};

