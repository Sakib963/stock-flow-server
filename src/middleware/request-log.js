const crypto = require("crypto");
const { TABLE } = require("../utils/constant");
const database = require("../db/database");
const { describe_device } = require("../auth/user-agent");
const { log } = require("../utils/log");

const REDACTED_KEYS = new Set(["password", "new_password", "current_password", "confirm_password", "access_token", "refresh_token", "otp", "token"]);
const REQUEST_BODY_MAX_BYTES = 16 * 1024;
const RESPONSE_BODY_MAX_BYTES = 4 * 1024;

const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(inner)]));
    return value;
};

const capped = (value, max) => {
    if (value === undefined || value === null) return null;
    const text = JSON.stringify(value);
    const bytes = Buffer.byteLength(text);
    return bytes <= max ? text : JSON.stringify({ truncated: true, bytes, head: text.slice(0, max) });
};

const parse = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const route_of = (request) => (request.route?.path ? { route: request.baseUrl + request.route.path, unmatched_route: false } : { route: request.path, unmatched_route: true });

const insert = (row) => {
    const columns = Object.keys(row);
    return database.execute_value({
        text: `INSERT INTO ${TABLE.API_REQUEST_LOG} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        values: Object.values(row),
    });
};

// Awaited before the response is sent: Vercel may freeze the function once it has been. A failed
// insert is logged and never changes the response.
const request_log = (request, res, next) => {
    const request_id = crypto.randomUUID();
    request.request_id = request_id;
    res.setHeader("X-Request-Id", request_id);
    if (process.env.REQUEST_LOG_ENABLED === "false") return next();

    const started = process.hrtime.bigint();
    const { write, end } = res;
    let response_bytes = 0;

    res.write = function (chunk, ...rest) {
        if (chunk) response_bytes += Buffer.byteLength(chunk);
        return write.call(this, chunk, ...rest);
    };

    res.end = function (chunk, ...rest) {
        res.end = end;
        const body = typeof chunk === "function" ? null : chunk;
        if (body) response_bytes += Buffer.byteLength(body);
        const credentials = request.credentials ?? {};
        const city = request.headers["x-vercel-ip-city"];

        insert({
            oid: request_id,
            method: request.method,
            ...route_of(request),
            path: request.originalUrl.slice(0, 1024),
            status: res.statusCode,
            duration_ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
            request_bytes: Number(request.headers["content-length"]) || 0,
            response_bytes,
            login_oid: credentials.login_oid ?? null,
            session_oid: credentials.session_oid ?? null,
            ip: request.ip ?? null,
            country: request.headers["x-vercel-ip-country"] ?? null,
            city: city ? decodeURIComponent(city) : null,
            device: describe_device(request.headers["user-agent"]),
            request_body: request.body && Object.keys(request.body).length ? capped(redact(request.body), REQUEST_BODY_MAX_BYTES) : null,
            response_body: res.statusCode >= 500 && body ? capped(redact(parse(body.toString())), RESPONSE_BODY_MAX_BYTES) : null,
        })
            .catch((error) => log.error(`Could not record request ${request_id}: ${error?.message}`))
            .finally(() => end.call(res, chunk, ...rest));
        return res;
    };

    next();
};

module.exports = { request_log, redact, capped };
