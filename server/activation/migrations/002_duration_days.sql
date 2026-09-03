-- StrixGeo activation service — migration 002: duration keys (debt #3).
--
-- WHY this file exists: schema.sql is the fresh-install definition, but the
-- production database on Combell was already created from the ORIGINAL schema.sql
-- (five tables, `expires_at NOT NULL`, no `duration_days`). Re-running the whole
-- schema.sql would not add the new column to the existing `licences` table
-- (CREATE TABLE IF NOT EXISTS is a no-op once the table exists). This migration
-- brings that live table up to the duration-key shape WITHOUT touching any data.
--
-- What it does:
--   1. Add `licences.duration_days INT UNSIGNED NULL` (the N-day clock length).
--   2. Make `licences.expires_at` NULLable (NULL = a dormant duration key).
--   3. Recreate `v_who_is_testing` so it surfaces `duration_days`.
--
-- It is IDEMPOTENT — safe to run more than once. MySQL 8 has no
-- `ADD COLUMN IF NOT EXISTS` (that is a MariaDB extension), so the add is guarded
-- against information_schema and only fires when the column is missing. MODIFY and
-- CREATE OR REPLACE VIEW are naturally re-runnable.
--
-- HOW to run it (pick one; run against the activation database, e.g.
-- ID502440_StrixGeo):
--
--   * phpMyAdmin: open the database, click the SQL tab, paste this whole file,
--     press Go. (phpMyAdmin runs the multi-statement batch as one session, so the
--     @-variables and PREPARE below work.)
--
--   * mysql client over SSH on the Combell host:
--       mysql -h ID502440_StrixGeo.db.webhosting.be -u ID502440_StrixGeo -p \
--             ID502440_StrixGeo < migrations/002_duration_days.sql
--
-- After it runs, `php bin/mint.php --duration-days 30 …` mints a dormant key and
-- `php bin/who.php` / GET /admin/who show the new column.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. Add licences.duration_days only when it is not already present.
--    A guarded PREPARE avoids the "Duplicate column name" error on a re-run.
-- ---------------------------------------------------------------------------
SET @add_duration := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'licences'
        AND COLUMN_NAME = 'duration_days'
    ),
    'SELECT 1',
    'ALTER TABLE licences ADD COLUMN duration_days INT UNSIGNED NULL AFTER seats'
  )
);
PREPARE stmt_add_duration FROM @add_duration;
EXECUTE stmt_add_duration;
DEALLOCATE PREPARE stmt_add_duration;

-- ---------------------------------------------------------------------------
-- 2. Make expires_at NULLable (NULL = a dormant, not-yet-activated duration key).
--    MODIFY re-applies the same definition harmlessly if the column is already
--    NULLable, so no guard is needed; it never drops or rewrites row data here.
-- ---------------------------------------------------------------------------
ALTER TABLE licences MODIFY expires_at DATETIME NULL;

-- ---------------------------------------------------------------------------
-- 3. Recreate the owner's read-out view so duration_days shows alongside the
--    (now possibly NULL) expiry. CREATE OR REPLACE VIEW is idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_who_is_testing AS
SELECT
  l.id                                                          AS licence_id,
  l.holder_name,
  l.holder_email,
  l.tier,
  l.duration_days,
  l.expires_at,
  l.revoked_at,
  d.device_id,
  d.device_label,
  d.activated_at,
  d.last_refresh_at,
  d.deactivated_at,
  (SELECT MAX(e.created_at) FROM activation_events e WHERE e.licence_id = l.id)                          AS last_event_at,
  (SELECT COUNT(*) FROM activation_events e WHERE e.licence_id = l.id AND e.kind = 'activate')           AS activate_count,
  (SELECT COUNT(*) FROM activation_events e WHERE e.licence_id = l.id AND e.kind = 'refresh')            AS refresh_count,
  (SELECT COUNT(*) FROM activation_events e WHERE e.licence_id = l.id AND e.kind = 'deactivate')         AS deactivate_count,
  (SELECT COUNT(*) FROM activation_events e WHERE e.licence_id = l.id AND e.kind = 'refused')            AS refused_count,
  (SELECT COUNT(*) FROM activation_events e WHERE e.licence_id = l.id)                                   AS event_count
FROM licences l
LEFT JOIN devices d ON d.licence_id = l.id
ORDER BY COALESCE(d.last_refresh_at, d.activated_at) DESC;
