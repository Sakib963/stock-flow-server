# Development data

The development database (the cloud one named in `src/env/.env`) holds StockFlow's own made-up
company: a year of counter sales, online orders, deliveries, returns, purchase orders, stock
adjustments, pre-orders and campaigns, all done through the app's own endpoints by six made-up staff.
The Owner and the System Admin are real accounts; everyone at `@stockflow.com` is made up.

| Person | Email | Role | Does |
| --- | --- | --- | --- |
| Tahmina Akter | tahmina.akter@stockflow.com | Manager | Purchase orders, stock adjustments, disposals, giveaways, campaigns, counter returns |
| Rakib Hasan | rakib.hasan@stockflow.com | Staff | Counter sales, mornings |
| Sumaiya Islam | sumaiya.islam@stockflow.com | Staff | Counter sales, evenings |
| Nafisa Rahman | nafisa.rahman@stockflow.com | Staff | Online orders and pre-orders |
| Siam Ahmed | siam.ahmed@stockflow.com | Staff | Online orders and pre-orders |
| Habib Uddin | habib.uddin@stockflow.com | Staff | Delivery batches, failed parcels, online returns, refunds |

Nothing here runs by itself. You run it when you want the data to reach today.

## Fill the missing days

Run this whenever the data has fallen behind, from the `stock-flow-server` folder:

```bash
node tools/seed-dev-data.js --catch-up --cloud
node tools/verify-seed-data.js
```

The first command finds the last thing the staff did, then plays every day from there up to 15
minutes ago: new counter sales and online orders, and everything left half done moves on. Pending
orders are confirmed, parcels with the courier are delivered or come back, purchase orders arrive and
get paid, pre-orders convert, campaigns start and finish. It prints one line per day, then `Done`.
If the data is already current it says `Nothing to fill` and changes nothing.

The second command checks the result: the stock ledger adds up for every batch, nothing went below
zero, totals and payments are consistent, and no time lies in the future. It must end with
`Every check passed`. If a check fails, stop and look before running anything else.

**How long it takes.** On a local database twelve days took about a minute. Against the cloud every
action crosses the internet, so expect it to be much slower; leave it running until it prints `Done`.

### Good to know

- **Let it finish.** Do not stop it with Ctrl+C: the last step moves the new rows onto the business's
  clock, and a run cut short leaves rows stamped with the real time, which makes the next catch-up
  think nothing is missing. If it stops on an error of its own, it still does that step; read the
  message, then run the verify command.
- **One run at a time.** Two runs at once would both play the same days.
- **The staff's passwords change on every run**, to random ones nobody sees. To sign in as one of
  them, reset their password from the System Admin account.
- **Your own work in the app is safe.** Orders or changes you make yourself are kept, and they do not
  count as the business's last day.
- **It only touches the database it is pointed at.** Without `--cloud` it refuses anything but a
  local database, and the first-time seed refuses a database that already has orders.

## Start again from nothing

Rarely needed: when the schema changed in a way the seed cannot carry on from, or the data is beyond
repair. This is what was done on 2026-10-23; ask Claude to do it with these steps.

1. Back up the cloud database to `C:\Users\user\Documents\stockflow-backups\` with `pg_dump`, and
   restore the backup into a local database once to prove it is good.
2. Build a local database (Postgres 16 on port 5433, time zone UTC) from
   `stock-flow-documents/generated_schema.sql`.
3. Copy from the backup what belongs to the business rather than the schema: the Manager and Staff
   roles, the Owner, Manager and Staff grants, the Owner and System Admin accounts, and the settings row.
4. Seed a year into it, then verify:

   ```bash
   DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASSWORD= DB_NAME=<local database> DB_SSL=false node tools/seed-dev-data.js
   DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASSWORD= DB_NAME=<local database> DB_SSL=false node tools/verify-seed-data.js
   ```

   Seeding locally takes about fifteen minutes; seeding the cloud directly would take hours.
5. Load the local database onto the cloud in one transaction: drop and recreate the `public` schema,
   load a `pg_dump` of the local database, and grant the order tracker its read access again
   (`stock-flow-documents/migrations/2026-08-22-tracker-readonly-role.sql`). If any step fails,
   nothing changes.
6. Run `node tools/verify-seed-data.js` against the cloud, and
   `node ../stock-flow-documents/tools/verify-schema.js` to confirm the schema still matches.

`--days=<n>` seeds fewer days, and `--until=<moment>` makes a seed stop at a moment in the past, which
is how the catch-up is tested.
