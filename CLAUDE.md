# stock-flow-server: agent guide

Express and PostgreSQL API, no ORM, raw parameterized SQL. Branch `refactor/order-sales-core`. The
workspace guide (`../CLAUDE.md`) holds the business rules, access control, engineering practice and
writing style; this file holds what is specific to the server. Both apply.

**Exemplars.** For a plain CRUD feature start from **supplier** (`src/routes/configuration/supplier/`)
for shape, but take route guarding from **admin/user** (`src/routes/admin/user/routes.js`), because
supplier is not ported yet and carries no permission checks. For anything multi-item or
transactional use **purchase-order** or **returns** (`src/routes/sales/return/controller/confirm-return.js`).

## Layout

| Where | What |
| --- | --- |
| `server.js` | The Express app, exported for the tests |
| `src/routes/routes.js` | Mounts every module router under its `CONTEXTS` path |
| `src/routes/<module>/routes.js` | Mounts each feature router under its `SUB_CONTEXTS` path |
| `src/routes/<module>/<feature>/route.js` | The feature's endpoints, with `schema.js`, `controller/` and `utils/` beside it |
| `src/routes/<module>/<feature>/utils/` | Helpers only this feature uses. Never inside `controller/` |
| `src/routes/<module>/utils/` | Helpers several features of one module share (`sales/utils/`) |
| `src/middleware/` | `validate-jwt`, `require-permission`, `validator`, `rate-limit`, `request-log` |
| `src/db/` | `database`, `db.config`, `list-query` |
| `src/auth/`, `src/email/` | Sessions, tokens, password rules, device names; sending and rendering email |
| `src/utils/` | What everything shares: constants, the logger, activity log, config version, settings cache |
| `src/env/.env` | Local settings, git-ignored |
| `test/` | `node:test` suites against a local Postgres, see `test/README.md` |

Utilities that already exist and must be used rather than re-implemented:

| Helper | Use |
| --- | --- |
| `db/database.js` | `get_data`, `execute_value`, `execute_values`, `execute_transaction`, `fail` |
| `utils/constant.js` | `TABLE`, `CONTEXTS`, `SUB_CONTEXTS`, `ROUTES` |
| `middleware/validate-jwt.js` | `jwtMiddleware`: who you are, and whether the session is still live |
| `middleware/require-permission.js` | `requirePermission(code)`: whether you may |
| `middleware/validator.js` | `validator.get(schema)` / `validator.post(schema)` with Joi |
| `utils/activity-logger.js` | `saveLogActivity(entry, { tx, request })`, written in the change's transaction |
| `utils/config-version.js` | `bump_config_version(tx)` after writing a role, grant, menu item or settings |
| `routes/sales/utils/stock-movement.js` | Guarded stock deduct and restock, product stat counters |
| `routes/sales/utils/order-utils.js` | `resolveAmountPaid`, `recordStatusHistory` |
| `routes/sales/return/utils/return-utils.js` | `effectiveAmountPaid`, returnable statuses |
| `utils/log.js` | Winston logger. Never `console.log` in `src/` |
| `middleware/rate-limit.js` | Database-backed throttle, because Vercel spreads requests across instances |

## Endpoints

- **Three-tier router**: `routes.js` → module `routes.js` → feature `route.js`. One controller file
  per action. **One feature, one router folder**: do not scatter a feature's endpoints across others.
- **Every route is `[jwtMiddleware, requirePermission('module.feature.action'), validator.x(schema)]`**,
  in that order. `requirePermission` after `jwtMiddleware` always: it reads `request.credentials`.
  The only routes without them are in `routes/auth/`, each with a comment saying why (a person who
  has forgotten their password, or whose access token lapsed, has no token).
- A route with no permission is a bug, not a default. The code must already exist in the
  `permission` table: if the feature needs a new action, add it to a seed migration first (the
  `db-migration` skill). An unseeded code denies everyone.
- Names come from `constant.js`. No literal table names or route paths in controllers or routes.
- **Response envelope everywhere:** `{ code, message, data, total? }`. The client checks
  `res.status === 200 && res.body.code === 200`.
- Status codes: **400** invalid input, **401** no or expired token (the client signs out on it),
  **403** authenticated but lacking the permission, **404** not found, **409** a guarded transition
  whose record is not in the expected state (answer with its actual state), **429** throttled.
- **Every mutation calls `saveLogActivity(entry, { tx, request })` inside its transaction**, so the
  row carries the request id and a rolled back change leaves none. The form without `{ tx, request }`
  is the old fire-and-forget write; a controller being ported moves off it. Stock-moving
  confirmations also log under the `reference_type` the analytics read: `product-return`,
  `product-dispose`, `purchase`.
- **Every request is already recorded** in `api_request_log` by `middleware/request-log.js`: route,
  status, timing, account, origin, the request body of a write with credentials redacted, and the
  response body of a 5xx. A controller never logs requests itself. A new credential field name goes
  into its redaction list in the same change, with a test.
- Anything that writes a role, a permission grant, a menu item or the settings row calls
  `bump_config_version(tx)` in the same transaction, or clients serve a stale menu.

## Database access

- **All access goes through `db/database.js`.** Never `pool.connect()`, `client.query`, or a
  hand-written `BEGIN` / `COMMIT` / `ROLLBACK` anywhere else, and never require `db.config` outside it.
- Read, decide and write inside one transaction with `execute_transaction(async (tx) => …)`. Abort
  with `fail(code, message)`, which rolls back and becomes the response. Lock the rows you decide
  on with `FOR UPDATE`.
- **Guarded transitions**: `UPDATE … WHERE oid = $1 AND status = <expected>`, then check `rowCount`.
  Zero rows is a 409 with the record's actual state.
- **Every stock movement is guarded in SQL** (`WHERE quantity_available >= $1`) and verified through
  `rowCount`. Use `stock-movement.js`, which already does.
- A counter that must survive a rollback (failed attempts, throttles) is written outside the
  transaction, because `fail()` rolls back everything inside it.
- Columns follow the database conventions: `oid` uuid, audit columns `created_by` / `created_on` /
  `edited_by` / `edited_on` (never `_at`), TitleCase `status`. See `../stock-flow-documents/CLAUDE.md`.
- **The database is the shared cloud instance**, `max_connections` 20, shared with the tracker.
  Read-only probes are free. Before a write, know how many rows it touches. To try rewritten SQL,
  run it in `execute_transaction` and throw at the end, then confirm nothing persisted.
- Where a list is unbounded, read it with `= ANY($1)` rather than one query per row.

## Money and trust

- Never trust a client-supplied `amount_paid`, price, discount total or line total. Recompute on the
  server: `resolveAmountPaid` to write, `effectiveAmountPaid` to read, and
  `(unit_price - discount) * quantity` for a line.
- Never log a secret, token, password or OTP. A generated OTP was once written to the log at info
  level, which handed account takeover to anyone who could read it.
- Authorisation fails closed. A check that cannot run is a denial.

## Configuration

- Every new environment variable gets a default in code where one is safe, a line in
  `src/env/.env`, and its deploy-day step in `../plan/release-checklist.md` in the same change.

## Verify

- Load the routers: `node -e "require('./src/routes/routes')"`.
- Exercise the controller you changed, against a real request.
- `npm test` runs every `test/**/*.test.js` against a local Postgres rebuilt from
  `generated_schema.sql`, never the cloud. The instance does not start with Windows; the start
  command is in `test/README.md`. **Anything touching auth, sessions, permissions, stock or money
  keeps this suite green and adds the tests that prove the change.** Name a test for the behaviour a
  person would recognise, as `test/auth/sessions.test.js` does.
- The pre-commit hook in the workspace loads the routers and runs `npm test` before any commit that
  touches `src/` or `test/`.
