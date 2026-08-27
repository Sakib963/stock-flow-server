const pool = require('./db.config');
const log = require('./log');

// Retry logic for transient connection errors
const retryQuery = async (queryFn, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await queryFn();
        } catch (error) {
            const isRetriableError =
                !error.no_retry &&
                (error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNREFUSED' ||
                error.code === '57P01' || // admin_shutdown
                error.code === '57P03' || // cannot_connect_now
                error.code === '08006' || // connection_failure
                error.code === '08003' || // connection_does_not_exist
                error.message?.includes('Connection terminated') ||
                error.message?.includes('server closed the connection'));

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
            const res = await pool.query(query);
            return { rowCount: res.rowCount, rows: res.rows };
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

// -----------------------------------------------------------------------------
// Interactive transactions
//
// `execute_values` covers the common case: a fixed list of writes that must all
// land or none. It cannot express work that has to READ inside the transaction
// and then decide what to write (row locks, guarded updates checked via
// rowCount, generated numbers). That is what `execute_transaction` is for.
//
// Nothing outside this file may call `pool.connect()` or issue BEGIN / COMMIT /
// ROLLBACK. Controllers get a `tx` handle that mirrors the pool-level helpers.
// -----------------------------------------------------------------------------

// A business outcome that must abort the transaction and answer with a 4xx.
// It is not a database fault, so it is never logged as one and never retried.
class TransactionError extends Error {
    constructor(code, message, data = null) {
        super(message);
        this.name = "TransactionError";
        this.code = code;
        this.data = data;
        this.no_retry = true;
    }
}

// Abort the running transaction with an HTTP-shaped outcome, e.g.
// `fail(409, "Only Pending orders can be confirmed")`. Everything written so far
// is rolled back; the controller turns it into the response envelope.
const fail = (code, message, data = null) => {
    throw new TransactionError(code, message, data);
};

// The handle handed to the transaction body. Same names and same return shapes
// as the pool-level helpers, scoped to this one connection.
const transaction_scope = (client) => ({
    get_data: async (query) => {
        const res = await client.query(query);
        return res.rows;
    },
    execute_value: async (query) => {
        const res = await client.query(query);
        return { rowCount: res.rowCount, rows: res.rows };
    },
    execute_values: async (queries) => {
        for (const q of queries) await client.query(q);
    },
});

// Run `work(tx)` inside ONE transaction. Returns whatever `work` returns after a
// successful COMMIT. Any throw (including `fail(...)`) rolls everything back.
// BEGIN/COMMIT/ROLLBACK, client release and connection retry all live here.
const execute_transaction = async (work) => {
    return retryQuery(async () => {
        const client = await pool.connect();
        let commit_sent = false;
        try {
            await client.query("BEGIN");
            const result = await work(transaction_scope(client));
            commit_sent = true;
            await client.query("COMMIT");
            return result;
        } catch (e) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                log.error("Error during rollback: ", rollbackError);
            }
            if (e instanceof TransactionError) throw e;
            // Once COMMIT is on the wire its outcome is unknown, so replaying the
            // work could apply it twice.
            if (commit_sent) e.no_retry = true;
            log.error("Unable to execute transaction in database: ", e);
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
    execute_transaction,
    TransactionError,
    fail,
};
