# Server tests

```
npm test
```

Rebuilds a local database from `stock-flow-documents/generated_schema.sql`, then runs every
`test/**/*.test.js` against the real Express app on a free port. It never touches the shared cloud
database: `support/create-test-db.js` refuses to run against anything but a local `*_test`
database, because it drops the one it is pointed at.

Settings live in `test/.env.test`. It is committed on purpose and holds no real credential.

## The local Postgres

Portable PostgreSQL 16.15 binaries, the same version as the cloud database, unpacked without an
installer so no administrator rights were needed. Port 5433, trust authentication, listening on
localhost only.

| | |
|---|---|
| Binaries | `C:\Users\user\postgres16\pgsql\bin` |
| Data | `C:\Users\user\postgres16\data` |
| Log | `C:\Users\user\postgres16\server.log` |

It does not start with Windows. After a reboot:

```
C:\Users\user\postgres16\pgsql\bin\pg_ctl.exe start -D C:\Users\user\postgres16\data -l C:\Users\user\postgres16\server.log -o "-p 5433 -c listen_addresses=localhost"
```

Stop it with `pg_ctl.exe stop -D C:\Users\user\postgres16\data`.

On a new machine: download `postgresql-16.15-1-windows-x64-binaries.zip` from EnterpriseDB, unpack
it, then `initdb.exe -D data -U postgres --auth=trust -E UTF8 --locale=C` and start it as above.

## What is covered

| File | Covers |
|---|---|
| `auth/sign-in-and-access.test.js` | Sign-in, cookie flags, token claims, generic failures, inactive accounts, throttling, and every way an access token is refused |
| `auth/refresh-and-sign-out.test.js` | Rotation, the grace window, reuse detection, both lifetimes, racing renewals, sign-out |
| `auth/revocation.test.js` | Sign out everywhere, password reset and change, turning an account off, the audit trail holding no token |
| `auth/body-transport.test.js` | The same lifecycle with `AUTH_REFRESH_TRANSPORT=body` |

Email is replaced with a stub in `support/harness.js`, so a test can never send one.
