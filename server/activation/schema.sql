-- StrixGeo activation service — MySQL 8 schema (debt #3).
--
-- Home: the strixgeo.com Combell shared hosting (PHP 8.x + MySQL 8, 100 MB).
-- This is the store behind the HTTP contract in
-- docs/design/activation-api-contract.md. Run it ONCE in the Combell database
-- panel (or `mysql <db> < schema.sql`) against a fresh database created there.
--
-- Conventions:
--   * utf8mb4 throughout (holder names / notes may carry non-ASCII).
--   * All DATETIME columns are UTC. The PHP layer runs the session at
--     `SET time_zone = '+00:00'`, so NOW() and every stored instant are UTC, and
--     the wire licence (epoch-millisecond integers, contract §1) is a pure
--     conversion with no zone guessing.
--   * The raw licence key is NEVER stored — only its SHA-256 hex digest
--     (`key_hash`). A leaked database therefore cannot activate anything.
--   * Every lookup column carries an index; the tables stay tiny (a beta cohort),
--     so the indexes are for correctness of the owner's ad-hoc queries, not scale.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- licences — one row per key the owner mints (bin/mint.php). The source of
-- truth for tier and seat count; `seats` is the device cap (Solo/trial = 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licences (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  key_hash     CHAR(64)        NOT NULL,               -- SHA-256 hex of the opaque key; raw key never stored
  tier         ENUM('solo','pro','studio','trial') NOT NULL,
  holder_name  VARCHAR(191)    NULL,                   -- who the owner issued it to (trial: the device label)
  holder_email VARCHAR(191)    NULL,
  seats        INT UNSIGNED    NOT NULL DEFAULT 1,      -- device cap; 1 = Solo/trial, >1 = Pro/Studio
  duration_days INT UNSIGNED   NULL,                    -- beta-cohort key: the N-day clock runs from FIRST activation, not from mint. While set with a NULL expires_at the key is DORMANT; the server stamps expires_at = activation + duration_days at the first successful activation (owner ruling 2026-09-03). NULL here = a plain dated key whose expires_at is fixed at mint.
  expires_at   DATETIME        NULL,                    -- authoritative end (UTC). NULL = dormant: a duration key not yet activated. Set at mint for a dated key, at first activation for a duration key, at issue for a trial. A NULL value is treated everywhere as "not expired" (dormant), never as a missing/dead licence.
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   DATETIME        NULL,                   -- set by bin/revoke.php; a revoked key reads as key_unknown
  notes        TEXT            NULL,
  UNIQUE KEY uq_licences_key_hash (key_hash),
  KEY idx_licences_tier    (tier),
  KEY idx_licences_email   (holder_email),
  KEY idx_licences_expires (expires_at),
  KEY idx_licences_revoked (revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- devices — one row per (licence, device) binding. A re-activation of the same
-- device reuses its row (deactivated_at back to NULL); a deactivate sets
-- deactivated_at (the seat is freed for transfer). A trial "used" for a device
-- is remembered as a row here even after deactivation, so a device cannot mint a
-- second trial by deactivating the first.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  licence_id      BIGINT UNSIGNED NOT NULL,
  device_id       VARCHAR(191)    NOT NULL,            -- client hardware fingerprint (opaque; not a secret)
  device_label    VARCHAR(191)    NULL,               -- hostname, for the owner's admin view
  activated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_refresh_at DATETIME        NULL,               -- bumped on every /activate refresh and /refresh
  deactivated_at  DATETIME        NULL,               -- NULL = active binding; set = seat freed
  CONSTRAINT fk_devices_licence FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE CASCADE,
  UNIQUE KEY uq_devices_licence_device (licence_id, device_id), -- one binding row per (licence, device)
  KEY idx_devices_licence (licence_id),
  KEY idx_devices_device  (device_id),
  KEY idx_devices_active  (licence_id, deactivated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- activation_events — the table the owner reads to "see who is testing and
-- when". ONE row for EVERY activate / trial / deactivate / refresh call,
-- successes AND refusals (kind='refused'). `detail` carries the refusal code,
-- the tier, or any extra context as JSON.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activation_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  licence_id BIGINT UNSIGNED NULL,                    -- NULL for an unknown-key refusal (no licence to point at)
  device_id  VARCHAR(191)    NOT NULL,
  kind       ENUM('activate','refresh','deactivate','trial','refused') NOT NULL,
  ip         VARCHAR(45)     NULL,                    -- IPv4 or IPv6
  user_agent VARCHAR(255)    NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detail     JSON            NULL,
  CONSTRAINT fk_events_licence FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE SET NULL,
  KEY idx_events_licence (licence_id),
  KEY idx_events_device  (device_id),
  KEY idx_events_kind    (kind),
  KEY idx_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- diagnostics_bundles — one consent-gated crash/diagnostics bundle (contract
-- §4, POST /v1/diagnostics). `bundle_id` is the client's opaque bundleId and the
-- dedup key (a UNIQUE index; a re-sent bundle updates nothing and returns the
-- same id). `payload` holds the whole JSON body; the PHP layer refuses a body
-- over 512 KiB with 413 before it ever reaches here.
--
-- NOTE: `bundle_id` is one column beyond the brief's list — it is required by the
-- contract's "the server dedups on this [bundleId]" (§4). Recorded in the deploy
-- doc + the build report as a faithful extension, not scope creep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostics_bundles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bundle_id   VARCHAR(191)    NULL,                   -- client bundleId; dedup target (contract §4)
  received_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  device_id   VARCHAR(191)    NULL,                   -- optional identity (contract §4 "Identity")
  licence_id  BIGINT UNSIGNED NULL,                   -- resolved from optional licenceKey, else NULL
  app_version VARCHAR(64)     NULL,
  platform    VARCHAR(32)     NULL,                   -- process.platform
  build_id    VARCHAR(128)    NULL,                   -- beta build stamp, when present
  size_bytes  INT UNSIGNED    NOT NULL DEFAULT 0,     -- UTF-8 byte length of the received body
  payload     JSON            NOT NULL,               -- the whole bundle; app enforces the 512 KiB cap
  ip          VARCHAR(45)     NULL,
  CONSTRAINT fk_diag_licence FOREIGN KEY (licence_id) REFERENCES licences(id) ON DELETE SET NULL,
  UNIQUE KEY uq_diag_bundle (bundle_id),
  KEY idx_diag_device   (device_id),
  KEY idx_diag_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- rate_limits — a fixed-window per-IP counter. `window_start` is the epoch-second
-- bucket start (now - now % window). The PHP layer INSERTs / increments per
-- request and refuses with 429 once `count` passes the configured ceiling. Old
-- windows are swept opportunistically, so the table never grows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  ip           VARCHAR(45)     NOT NULL,
  window_start BIGINT UNSIGNED NOT NULL,              -- epoch-seconds bucket start
  count        INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start),
  KEY idx_rate_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- v_who_is_testing — the owner's read-out: one row per (licence, device) with
-- holder, tier, device label, last-seen instant and per-licence event counts.
-- Read from the CLI with `php bin/who.php` or over HTTP at GET /admin/who.
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
