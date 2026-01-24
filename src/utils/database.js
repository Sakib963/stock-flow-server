const pool = require('./db.config');
const log = require('./log');

// Retry logic for transient connection errors
const retryQuery = async (queryFn, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await queryFn();
        } catch (error) {
            const isRetriableError = 
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNREFUSED' ||
                error.code === '57P01' || // admin_shutdown
                error.code === '57P03' || // cannot_connect_now
                error.code === '08006' || // connection_failure
                error.code === '08003' || // connection_does_not_exist
                error.message.includes('Connection terminated') ||
                error.message.includes('server closed the connection');

            if (isRetriableError && attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                log.warn(`Database query failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const get_data = async (query) => {
    return retryQuery(async () => {
        try {
            const res = await pool.query(query);
            return res.rows;
        } catch (e) {
            log.error("Unable to execute statement in database: ", e);
            throw e;
        }
    });
};

const execute_value = async (query) => {
    return retryQuery(async () => {
        try {
            await pool.query(query);
        } catch (e) {
            log.error("Unable to execute statement in database: ", e);
            throw e;
        }
    });
};

const execute_values = async (query) => {
    return retryQuery(async () => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (let q of query) await client.query(q);
            await client.query("COMMIT");
        } catch (e) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                log.error("Error during rollback: ", rollbackError);
            }
            log.error("Unable to execute statement in database: ", e);
            throw e;
        } finally {
            // Make sure client is released even if there's an error
            try {
                client.release();
            } catch (releaseError) {
                log.error("Error releasing client: ", releaseError);
            }
        }
    });
};

module.exports = {
    get_data,
    execute_value,
    execute_values,
};

