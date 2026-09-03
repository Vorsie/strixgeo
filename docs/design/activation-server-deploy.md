# Activation server — deploy runbook (debt #3)

**For:** the owner. **Style:** ASD-STE100 (short sentences, one instruction each).
**Goal:** put the StrixGeo activation service on the strixgeo.com Combell hosting
tonight, then point the desktop app at it.

The service is in `server/activation/`. It is plain PHP 8 and MySQL 8. It needs
no Composer, no framework, and no PHP extension other than PDO MySQL (Combell has
it). It answers the five endpoints in
[activation-api-contract.md](activation-api-contract.md).

---

## 1. What you deploy

The service has these parts:

* `schema.sql` — the database tables and the `v_who_is_testing` view.
* `public/index.php` + `public/.htaccess` — the one web-served file (the router)
  and its Apache rules.
* `src/*.php` — the helper code (config, database, HTTP, rate limit, licence).
* `config.php` — the secrets file. You make it from `config.example.php`.
* `bin/mint.php`, `bin/revoke.php`, `bin/who.php` — the command-line tools.

The endpoints live under `https://strixgeo.com/api/activation`:

| Method + path | Purpose |
|---|---|
| `POST /activate` | Bind a key to a device. |
| `POST /trial` | Give a device a 30-day trial. |
| `POST /deactivate` | Free a device's seat (the transfer). |
| `POST /refresh` | Re-issue a bound device's licence. |
| `POST /v1/diagnostics` | Store one diagnostics bundle. |
| `GET /admin/events` | Read the last events (needs the admin token). |
| `GET /admin/who` | Read `v_who_is_testing` (needs the admin token). |

---

## 2. Before you start

You need three things:

1. The Combell control panel login.
2. Access to the strixgeo.com web space (FTP, SFTP, or the panel file manager).
3. This machine, with `uv` installed, to run the conformance test.

---

## 3. Make the database

1. Open the Combell control panel.
2. Create a new MySQL database. Write down the database name. ID502440_StrixGeo (ID502440_StrixGeo.db.webhosting.be)
3. Create a database user. Give it a strong password. (ID502440_StrixGeo) 
4. Give the user all rights on the new database.
5. Open the SQL console (phpMyAdmin, or the panel's SQL tool).
6. Select the new database.
7. Paste the full text of `server/activation/schema.sql`.
8. Run it.
9. Confirm the panel now lists five tables and one view. confirmed

The five tables are `licences`, `devices`, `activation_events`,
`diagnostics_bundles`, and `rate_limits`. The view is `v_who_is_testing`.

---

## 4. Upload the files

Keep the same folder shape. The web folder holds ONLY the router. The secrets and
the helper code stay ONE level up, so no URL can reach them.

Do this:

1. Find the site web root. On Combell it is `www`, under the home folder
   `/data/sites/web/strixgeocom`. The Astro site files are already there.
2. In the web root, make the folder `api`.
3. In `api`, make the folder `activation`. This is the URL `/api/activation`.
4. Copy the contents of `server/activation/public/` into
   `<webroot>/api/activation/`. This gives you
   `<webroot>/api/activation/index.php` and `<webroot>/api/activation/.htaccess`.
5. Copy the folder `server/activation/src/` into `<webroot>/api/`. This gives you
   `<webroot>/api/src/`.
6. Copy `server/activation/bin/` into `<webroot>/api/` (optional; you can also run
   the CLI tools over SSH from any copy).

The router reads `../src`. The config loader reads `../config.php`. Both paths
are relative, so the shape above is what makes them find each other:

```
<webroot>/api/activation/index.php     (the ONLY web-served file)
<webroot>/api/activation/.htaccess
<webroot>/api/src/config.php  db.php  http.php  ratelimit.php  licence.php
<webroot>/api/config.php               (you make this in step 5 — the secrets)
<webroot>/api/bin/mint.php  revoke.php  who.php   (optional)
```

**If Combell lets you set a folder outside the web root**, put `src/`, `config.php`,
and `bin/` there instead, and set `$STRIX_ACTIVATION_CONFIG` to the config path.
The default layout above is safe too: the `.htaccess` sends every URL to
`index.php`, each helper file refuses a direct hit (the `STRIX_ACT` guard), and
`config.php` holds the only secret.

---

## 5. Make the config file

1. Copy `config.example.php` to `<webroot>/api/config.php`.
2. Open `config.php`.
3. Set `db.host`, `db.name`, `db.user`, and `db.password` to the values from
   step 3. On Combell `db.host` is the panel hostname
   (`IDxxxxxx_name.db.webhosting.be`), not `localhost`.
4. Set `admin_token` to a long random string. To make one, run:
   `php -r "echo bin2hex(random_bytes(24)), PHP_EOL;"`. With no local PHP, any
   48-character random hex string does the same job.
5. Keep `trial_days = 30`, `grace_days = 30`, and `refresh_horizon_days = 30`
   unless you have a reason to change them.
6. Keep `require_https = true`.
7. Save the file.

Do NOT put `config.php` inside `api/activation/`. It must stay one level up.

---

## 6. Mint the first key

1. Open an SSH session on the hosting. In the Combell panel, `SSH` in the left
   menu must be ON. The user is `strixgeocom`, the host is `ssh.strixgeo.com`
   (fallback `ssh080.webhosting.be`). A key is registered under `SSH-keys`; its
   private half is `~/.ssh/strixgeo_combell_ed25519` on the owner's laptop.
2. Go to `www/api`.
3. Run this command. Change the holder, email, and date for the real tester:

   ```
   php bin/mint.php --tier solo --holder "Jane Doe" --email jane@firm.be --seats 1 --expires 2027-01-01
   ```

4. Copy the printed key. The tool shows the key ONE time only. The database keeps
   only its hash.
5. Give the key to the tester. The tester types it into the app's licence screen.

Mint the expiry far in the future (for example `2027-01-01`). The licence then
rolls forward on each refresh, up to that date.

---

## 7. Test the server from this machine

Run the conformance suite against the live server. Mint a FRESH key for the test,
so its one seat is free.

1. Mint a test key (step 6). Note the key.
2. On this machine, open a shell in the repo root.
3. Set the three environment variables (PowerShell):

   ```powershell
   $env:STRIX_ACTIVATION_URL = "https://strixgeo.com/api/activation"
   $env:STRIX_TEST_KEY = "STRIX-....-....-....-...."   # the fresh key from step 1
   $env:STRIX_ADMIN_TOKEN = "the admin_token from config.php"
   ```

4. Run the suite:

   ```powershell
   uv run pytest server/activation/tests/conformance -v
   ```

5. Confirm every test passes.

The suite checks the licence shape, the one-device Solo limit, the transfer, the
refresh, the trial, the diagnostics upload, the size limit, the bad-body case,
and that every call leaves an event row.

With no environment variables set, the suite skips. This keeps the normal unit
suite green.

---

## 8. Point the app at the server

Make one code change, then rebuild.

1. Open `desktop/src/main/activationConfig.ts`.
2. Find the constant `PACKAGED_ACTIVATION_URL`. It is near the top and reads:

   ```ts
   export const PACKAGED_ACTIVATION_URL: string | null = null
   ```

3. Change it to:

   ```ts
   export const PACKAGED_ACTIVATION_URL: string | null = 'https://strixgeo.com/api/activation'
   ```

4. Save the file.
5. Rebuild the installer (`cd desktop && npm run dist`).

This is the only edit a packaged build needs to go live. The URL must be
`https://` — the app refuses a plain-HTTP activation origin.

For a DEV test without a rebuild, do not change the file. Set the env var instead
and run the dev app:

```powershell
$env:STRIXGEO_ACTIVATION_URL = "https://strixgeo.com/api/activation"
```

---

## 9. What you see as the owner

You have two ways to read who is testing.

**Over SSH:**

```
php bin/who.php
```

This prints one line per device: the holder, the tier, the device name, the last
time it was seen, and the counts of activate / refresh / total events.

**Over HTTPS** (use the admin token):

* `https://strixgeo.com/api/activation/admin/who?token=YOUR_ADMIN_TOKEN`
  returns the same `v_who_is_testing` rows as JSON.
* `https://strixgeo.com/api/activation/admin/events?token=YOUR_ADMIN_TOKEN&limit=100`
  returns the last events as JSON.

The `activation_events` table is the record of who did what and when. It gets one
row for EVERY call — every activate, trial, deactivate, and refresh, and every
refusal (kind `refused`, with the reason in `detail`). Read it directly if you
want SQL:

```sql
SELECT created_at, kind, device_id, ip, detail
FROM activation_events
ORDER BY id DESC
LIMIT 50;
```

---

## 10. Notes and open points

* **The licence is not signed.** This build returns the plain licence object from
  contract §3. The Ed25519 signature is an open owner decision (contract §8). The
  desktop client accepts the unsigned object today.
* **The key format is `STRIX-XXXX-XXXX-XXXX-XXXX`.** The four groups use Crockford
  base32 (no I, L, O, U). The key is random. The tier is NOT in the key — the
  database row holds the tier. This is the recommended shape in the decision memo,
  and it does not pre-empt the open §8 choice.
* **A trial shows as tier `solo` on the wire.** The contract allows only
  `solo`, `pro`, or `studio` in the licence's `tier`, so a trial travels as a
  `solo` licence with `isTrial: true`. The database keeps `trial` as its own tier
  for your records.
* **`diagnostics_bundles.bundle_id` is one column beyond the task brief.** The
  contract dedups a re-sent bundle on its `bundleId`, so the column is needed. It
  is a faithful extension, not scope creep.
* **Refresh does not extend a key past its minted `expires_at`.** Each refresh
  returns `min(expires_at, now + refresh_horizon_days)`. So a paid key with a far
  expiry rolls forward (the grace clock resets), but a trial counts down to its
  real end, and a revoked or lapsed key stops working.
* **Revoke a key** with `php bin/revoke.php --key STRIX-...`. A revoked key then
  reads as unknown, and the tester returns to the activation screen.
* **Rate limit** is 60 requests per 10 minutes per IP. Change it in `config.php`
  if a real tester ever hits it.
* **Combell puts an nginx edge in front of Apache.** Plain `http://` gets a 301
  from nginx before the `.htaccess` runs. `X-Forwarded-For` is set, so the
  rate limit keys on the real client IP.
* **The CLI options take a space or `=`.** `--seats 1` and `--seats=1` both
  work. (Before 2026-09-03 the optional-value spec made `--seats 1` swallow
  every option after it, so `--expires` was reported missing.)
* **Stripe is not wired.** You mint and revoke keys by hand for the closed beta.
  A Stripe webhook that mints on payment is the next step, after the beta.

---

## 11. As deployed on 2026-09-03

* Files: `www/api/activation/{index.php,.htaccess}`, `www/api/src/`,
  `www/api/bin/`, `www/api/config.php`. Owner `strixgeocom`, files 644, dirs 755.
* PHP 8.4 (panel setting and CLI). MySQL 8 (`utf8mb4_0900_ai_ci`).
* Database `ID502440_StrixGeo` on `ID502440_StrixGeo.db.webhosting.be`.
* The filled `config.php` and the upload zip are kept locally in
  `server/activation/dist/` (gitignored). The admin token is in that file.
* Smoke checks: `/api/activation/` gives JSON 404; `/admin/who` gives 401
  without the token and `{"rows":[]}` with it; `/api/config.php` and
  `/api/src/db.php` give 403.
* Conformance suite: 7 of 7 passed against the live server.
* Licence id 1 (`Conformance test`, solo, expires 2027-01-01) is the suite's
  key. Do NOT give it to a tester. Licence id 2 is the trial the suite took.

---

## 12. 2026-09-03 late — duration keys

Owner ruling 2026-09-03: "Once the users activate their key, their 30 days timer
starts running." A beta-cohort key now carries a DURATION, not a fixed date. The
key stays dormant (no expiry) until the tester activates it; the server then stamps
`expires_at = activation + duration_days`. A later activation (a transfer, or a
refresh) does NOT move the clock — it only ever starts once.

**Migrate the live database FIRST (once, before you deploy the new PHP).** The
production `licences` table predates this change, so it needs the new column and a
nullable `expires_at`. Run the idempotent migration:

* phpMyAdmin: open `ID502440_StrixGeo`, click the SQL tab, paste the whole of
  `server/activation/migrations/002_duration_days.sql`, press Go.
* Or over SSH on the host:

  ```
  mysql -h ID502440_StrixGeo.db.webhosting.be -u ID502440_StrixGeo -p \
        ID502440_StrixGeo < migrations/002_duration_days.sql
  ```

It adds `licences.duration_days`, makes `expires_at` NULLable, and refreshes the
`v_who_is_testing` view. It is safe to run more than once.

**Mint a duration key** — use `--duration-days` instead of `--expires`:

```
php bin/mint.php --tier solo --holder "Jane Doe" --email jane@firm.be --seats 1 --duration-days 30
```

`--expires` and `--duration-days` are mutually exclusive; give exactly one. The key
prints once, dormant, with no expiry line — the 30 days begin when the tester
activates it.

**Conformance for the duration rule.** The suite gains
`test_duration_key_clock_starts_at_first_activation`, gated on its own env var. Mint
a FRESH duration key (one never activated) and point the test at it:

```powershell
$env:STRIX_ACTIVATION_URL = "https://strixgeo.com/api/activation"
$env:STRIX_TEST_DURATION_KEY = "STRIX-....-....-....-...."   # a FRESH --duration-days key
$env:STRIX_TEST_DURATION_DAYS = "30"                          # optional; defaults to 30
uv run pytest server/activation/tests/conformance -v
```

Mint it FRESH because the clock starts at the first activation: a key already
activated no longer starts at "now", so the case's ±10-minute check would fail. With
`STRIX_TEST_DURATION_KEY` unset the case skips and the rest of the suite runs
unchanged.

**As deployed, 2026-09-03 ~20:00 CEST.** Migration 002 applied over SSH with
the `mysql` client (credentials read on the server by a throw-away
`~/stage_dur/dbenv.php`, never copied off the box); `mint.php`, then
`activation/index.php` + `src/licence.php` swapped in with `php -l` first and
the previous files kept in `~/stage_dur/backup/`. Evidence: the new
conformance test RED against the old handler (`expiresAt` equal to
`issuedAt`), then 8/8 GREEN against the new one, and the conformance duration
licence stamped `first activation + 30 d`. Note the FPM opcache revalidates
every 2 s — a request in the first seconds after a file swap can still run the
old code; wait before judging a red. Beta cohort 1 (18 keys, 30 d from first
activation) minted right after; keys live only in `server/activation/dist/beta-keys.txt`.

