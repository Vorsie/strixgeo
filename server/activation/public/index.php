<?php

/**
 * StrixGeo activation service — single front controller (debt #3).
 *
 * Implements the HTTP contract in docs/design/activation-api-contract.md:
 *
 *   POST /activate         bind a paid key to a device; return its licence (§4)
 *   POST /trial            issue a one-per-device 30-day trial licence (§4)
 *   POST /deactivate       release a device's bindings — the transfer (§4)
 *   POST /refresh          re-verify a bound device, re-issue its licence (§4)
 *   POST /v1/diagnostics   accept a consent-gated diagnostics bundle (§4)
 *   GET  /admin/events     (admin token) recent activation events, as JSON
 *   GET  /admin/who        (admin token) the v_who_is_testing read-out
 *
 * Routes match on the tail of the path, so the app works unchanged whether it is
 * mounted at `/api/activation` or anywhere else. Every response is JSON. Every
 * activation call (success or refusal) leaves an `activation_events` row — the
 * table the owner reads to see who is testing and when.
 *
 * The engine (MySQL) lives entirely behind the helpers in ../src; this file owns
 * routing, the HTTPS + rate-limit guards, and the per-endpoint orchestration.
 */

declare(strict_types=1);

define('STRIX_ACT', 1);

require_once __DIR__ . '/../src/config.php';
require_once __DIR__ . '/../src/http.php';
require_once __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/ratelimit.php';
require_once __DIR__ . '/../src/licence.php';

/** Largest diagnostics body accepted before a 413 (contract §4). */
const STRIX_DIAGNOSTICS_MAX_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// Endpoint handlers. Each returns via strix_json / strix_error (which exit).
// ---------------------------------------------------------------------------

/**
 * POST /activate — bind a paid key to a device, or refresh an existing binding.
 *
 * @param PDO                 $pdo The database connection.
 * @param array<string,mixed> $cfg The loaded config.
 * @return never
 */
function strix_handle_activate(PDO $pdo, array $cfg): void
{
    $body = strix_read_json_object();
    if ($body === null) {
        strix_error(400, 'bad_request', 'request body must be a JSON object');
    }
    $key = strix_string_field($body, 'key', 191);
    $deviceId = strix_string_field($body, 'deviceId', 191);
    if ($key === null || $deviceId === null) {
        strix_error(400, 'bad_request', 'key and deviceId are required');
    }
    $label = strix_optional_string($body, 'deviceLabel');

    $licence = strix_find_licence($pdo, $key);
    if ($licence === null) {
        strix_log_event($pdo, null, $deviceId, 'refused', ['reason' => 'key_unknown']);
        strix_error(404, 'key_unknown', 'key not recognised');
    }

    $licenceId = (int) $licence['id'];
    $cap = max(1, (int) $licence['seats']);
    $alreadyBound = strix_find_device($pdo, $licenceId, $deviceId);
    $activeIsBound = $alreadyBound !== null && $alreadyBound['deactivated_at'] === null;

    // A NEW device (or a re-activation of a released one) needs a free seat; the
    // same active device is an idempotent refresh and never consumes a seat (§6).
    if (!$activeIsBound && strix_active_device_count($pdo, $licenceId) >= $cap) {
        $code = $cap === 1 ? 'key_bound_elsewhere' : 'seat_exhausted';
        strix_log_event($pdo, $licenceId, $deviceId, 'refused', ['reason' => $code]);
        strix_error(409, $code, 'device limit reached; deactivate a device to transfer');
    }

    // Bind the seat and, for a dormant DURATION key, start its clock — expires_at
    // is stamped NOW()+duration_days at THIS first activation (owner ruling
    // 2026-09-03) — atomically in one transaction, so a bound seat never lacks its
    // clock and a stamped clock never lacks its binding. A later activation (seat
    // moved, or a refresh via /activate) finds the clock already running and leaves
    // it (the stamp is guarded by `expires_at IS NULL`), so the 30 days do not reset.
    $pdo->beginTransaction();
    try {
        $device = strix_bind_device($pdo, $licenceId, $deviceId, $label);
        $stamped = strix_stamp_duration_if_dormant($pdo, $licence);
        if ($stamped !== null) {
            $licence = $stamped; // re-read row carries the authoritative expires_at
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    strix_log_event($pdo, $licenceId, $deviceId, 'activate', [
        'tier' => $licence['tier'],
        'idempotent' => $activeIsBound,
    ]);
    strix_json(200, ['licence' => strix_wire_licence(
        $licence,
        $key,
        $device,
        $label !== '' ? $label : (string) ($device['device_label'] ?? ''),
        (int) $cfg['grace_days'],
        (int) $cfg['refresh_horizon_days']
    )]);
}

/**
 * POST /trial — issue a one-per-device time-limited trial licence.
 *
 * @param PDO                 $pdo The database connection.
 * @param array<string,mixed> $cfg The loaded config.
 * @return never
 */
function strix_handle_trial(PDO $pdo, array $cfg): void
{
    $body = strix_read_json_object();
    if ($body === null) {
        strix_error(400, 'bad_request', 'request body must be a JSON object');
    }
    $deviceId = strix_string_field($body, 'deviceId', 191);
    if ($deviceId === null) {
        strix_error(400, 'bad_request', 'deviceId is required');
    }
    $label = strix_optional_string($body, 'deviceLabel');

    if (strix_device_has_trial($pdo, $deviceId)) {
        strix_log_event($pdo, null, $deviceId, 'refused', ['reason' => 'trial_already_used']);
        strix_error(409, 'trial_already_used', 'this device already used its free trial');
    }

    $minted = strix_mint_trial($pdo, $deviceId, $label, (int) $cfg['trial_days']);
    $licenceId = (int) $minted['row']['id'];
    $device = strix_find_device($pdo, $licenceId, $deviceId);
    strix_log_event($pdo, $licenceId, $deviceId, 'trial', ['trial_days' => (int) $cfg['trial_days']]);

    strix_json(200, ['licence' => strix_wire_licence(
        $minted['row'],
        $minted['key'],
        $device ?? ['id' => 0, 'device_id' => $deviceId],
        $label,
        (int) $cfg['grace_days'],
        (int) $cfg['refresh_horizon_days']
    )]);
}

/**
 * POST /deactivate — release every binding a device holds (the transfer).
 *
 * @param PDO $pdo The database connection.
 * @return never
 */
function strix_handle_deactivate(PDO $pdo): void
{
    $body = strix_read_json_object();
    if ($body === null) {
        strix_error(400, 'bad_request', 'request body must be a JSON object');
    }
    $deviceId = strix_string_field($body, 'deviceId', 191);
    if ($deviceId === null) {
        strix_error(400, 'bad_request', 'deviceId is required');
    }

    // Never seen → 404 (client clears the local licence and returns to activation).
    // Known but already released → 200 no-op (idempotent, §6).
    if (!strix_device_known($pdo, $deviceId)) {
        strix_log_event($pdo, null, $deviceId, 'refused', ['reason' => 'device_unknown']);
        strix_error(404, 'device_unknown', 'no binding held for this device');
    }

    $released = strix_deactivate_device($pdo, $deviceId);
    strix_log_event($pdo, null, $deviceId, 'deactivate', ['released' => $released]);
    strix_json(200, ['released' => true, 'seats_free' => $released]);
}

/**
 * POST /refresh — re-verify a still-bound device and re-issue its licence.
 *
 * @param PDO                 $pdo The database connection.
 * @param array<string,mixed> $cfg The loaded config.
 * @return never
 */
function strix_handle_refresh(PDO $pdo, array $cfg): void
{
    $body = strix_read_json_object();
    if ($body === null) {
        strix_error(400, 'bad_request', 'request body must be a JSON object');
    }
    $key = strix_string_field($body, 'key', 191);
    $deviceId = strix_string_field($body, 'deviceId', 191);
    if ($key === null || $deviceId === null) {
        strix_error(400, 'bad_request', 'key and deviceId are required');
    }

    $licence = strix_find_licence($pdo, $key);
    if ($licence === null) {
        strix_log_event($pdo, null, $deviceId, 'refused', ['reason' => 'key_unknown']);
        strix_error(404, 'key_unknown', 'key not recognised');
    }

    $licenceId = (int) $licence['id'];
    $device = strix_find_device($pdo, $licenceId, $deviceId);
    if ($device === null || $device['deactivated_at'] !== null) {
        strix_log_event($pdo, $licenceId, $deviceId, 'refused', ['reason' => 'key_bound_elsewhere']);
        strix_error(409, 'key_bound_elsewhere', 'this device is not bound to the key');
    }

    // Server-side hard end: past expires_at + grace, the licence is dead even if
    // the key still exists — the client keeps its own local verdict (§5). A NULL
    // expires_at is a DORMANT duration key: activation stamps it, so a bound device
    // whose licence still has a NULL expiry should not occur — treat it defensively
    // as "not expired" (there is no hard end to be past yet) and re-issue as active.
    if ($licence['expires_at'] !== null) {
        $deadAtMs = strix_dt_to_ms((string) $licence['expires_at']) + (int) $cfg['grace_days'] * STRIX_DAY_MS;
        if (strix_now_ms() > $deadAtMs) {
            strix_log_event($pdo, $licenceId, $deviceId, 'refused', ['reason' => 'licence_expired']);
            strix_error(403, 'licence_expired', 'the subscription has lapsed past its grace window');
        }
    }

    strix_touch_refresh($pdo, (int) $device['id']);
    strix_log_event($pdo, $licenceId, $deviceId, 'refresh', ['tier' => $licence['tier']]);
    strix_json(200, ['licence' => strix_wire_licence(
        $licence,
        $key,
        $device,
        (string) ($device['device_label'] ?? ''),
        (int) $cfg['grace_days'],
        (int) $cfg['refresh_horizon_days']
    )]);
}

/**
 * POST /v1/diagnostics — accept and store one consent-gated diagnostics bundle.
 *
 * @param PDO $pdo The database connection.
 * @return never
 */
function strix_handle_diagnostics(PDO $pdo): void
{
    $raw = strix_read_raw_body(STRIX_DIAGNOSTICS_MAX_BYTES);
    if ($raw === null) {
        // Over the 512 KiB cap → 413. The client drops the bundle (a 4xx), it does
        // not retry, so the oldest-first queue is not wedged (§4).
        strix_error(413, 'payload_too_large', 'diagnostics bundle exceeds the 512 KiB limit');
    }
    $body = json_decode($raw, true);
    if (!is_array($body) || array_is_list($body)) {
        strix_error(400, 'bad_request', 'diagnostics body must be a JSON object');
    }

    $bundleId = strix_optional_string($body, 'bundleId', '', 191);
    $deviceId = strix_optional_string($body, 'deviceId', '', 191);
    $appVersion = strix_optional_string($body, 'appVersion', '', 64);
    $platform = strix_optional_string($body, 'platform', '', 32);
    $buildId = strix_optional_string($body, 'buildId', '', 128);

    // Optional identity (§4): resolve a licence id from licenceKey when present.
    $licenceId = null;
    $licenceKey = strix_optional_string($body, 'licenceKey', '', 191);
    if ($licenceKey !== '') {
        $found = strix_find_licence($pdo, $licenceKey);
        if ($found !== null) {
            $licenceId = (int) $found['id'];
        }
    }

    // Dedup on the client's bundleId (§4): a re-sent bundle returns the same id.
    if ($bundleId !== '') {
        $dup = $pdo->prepare('SELECT id FROM diagnostics_bundles WHERE bundle_id = :b LIMIT 1');
        $dup->execute([':b' => $bundleId]);
        $existing = $dup->fetchColumn();
        if ($existing !== false) {
            strix_json(202, ['received' => true, 'id' => 'diag_' . (string) $existing]);
        }
    }

    $insert = $pdo->prepare(
        'INSERT INTO diagnostics_bundles '
        . '(bundle_id, device_id, licence_id, app_version, platform, build_id, size_bytes, payload, ip) '
        . 'VALUES (:b, :d, :l, :av, :pf, :bid, :sz, :payload, :ip)'
    );
    $insert->execute([
        ':b' => $bundleId !== '' ? $bundleId : null,
        ':d' => $deviceId !== '' ? $deviceId : null,
        ':l' => $licenceId,
        ':av' => $appVersion !== '' ? $appVersion : null,
        ':pf' => $platform !== '' ? $platform : null,
        ':bid' => $buildId !== '' ? $buildId : null,
        ':sz' => strlen($raw),
        ':payload' => $raw,
        ':ip' => strix_client_ip(),
    ]);
    $id = (int) $pdo->lastInsertId();
    strix_json(202, ['received' => true, 'id' => 'diag_' . (string) $id]);
}

/**
 * Guard an admin endpoint on the config's admin token (constant-time compare).
 *
 * @param array<string,mixed> $cfg The loaded config.
 * @return void Sends 401 and exits on a bad/missing token.
 */
function strix_require_admin(array $cfg): void
{
    $provided = $_GET['token'] ?? '';
    $expected = (string) ($cfg['admin_token'] ?? '');
    if (!is_string($provided) || $expected === '' || !hash_equals($expected, $provided)) {
        strix_error(401, 'unauthorized', 'admin token required');
    }
}

/**
 * GET /admin/events — the last N activation events as JSON (owner read-out).
 *
 * @param PDO                 $pdo The database connection.
 * @param array<string,mixed> $cfg The loaded config.
 * @return never
 */
function strix_handle_admin_events(PDO $pdo, array $cfg): void
{
    strix_require_admin($cfg);
    $limit = (int) ($_GET['limit'] ?? 50);
    $limit = max(1, min(500, $limit));

    $stmt = $pdo->prepare(
        'SELECT id, licence_id, device_id, kind, ip, user_agent, created_at, detail '
        . 'FROM activation_events ORDER BY id DESC LIMIT :n'
    );
    $stmt->bindValue(':n', $limit, PDO::PARAM_INT);
    $stmt->execute();

    $events = [];
    foreach ($stmt->fetchAll() as $row) {
        $events[] = [
            'id' => (int) $row['id'],
            'licenceId' => $row['licence_id'] === null ? null : (int) $row['licence_id'],
            'deviceId' => (string) $row['device_id'],
            'kind' => (string) $row['kind'],
            'ip' => $row['ip'],
            'userAgent' => $row['user_agent'],
            'createdAtMs' => strix_dt_to_ms((string) $row['created_at']),
            'detail' => $row['detail'] === null ? null : json_decode((string) $row['detail'], true),
        ];
    }
    strix_json(200, ['events' => $events]);
}

/**
 * GET /admin/who — the v_who_is_testing read-out as JSON.
 *
 * @param PDO                 $pdo The database connection.
 * @param array<string,mixed> $cfg The loaded config.
 * @return never
 */
function strix_handle_admin_who(PDO $pdo, array $cfg): void
{
    strix_require_admin($cfg);
    $rows = $pdo->query('SELECT * FROM v_who_is_testing')->fetchAll();
    strix_json(200, ['rows' => $rows]);
}

// ---------------------------------------------------------------------------
// Front controller: route, guard, dispatch. One try/catch turns any fault into
// a clean 5xx (the client treats it as `unreachable` and keeps its licence).
// ---------------------------------------------------------------------------

try {
    $cfg = strix_load_config();

    // HTTPS backstop (the .htaccess redirects too). A local `php -S` smoke test
    // sets STRIX_ALLOW_INSECURE=1; production always uses HTTPS.
    $allowInsecure = getenv('STRIX_ALLOW_INSECURE') === '1';
    if (!empty($cfg['require_https']) && !$allowInsecure && !strix_is_https()) {
        strix_error(400, 'bad_request', 'HTTPS required');
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $path = rtrim($path, '/');
    if ($path === '') {
        $path = '/';
    }

    $pdo = strix_db();

    // Rate limit every known-route request (contract §7).
    $limit = $cfg['rate_limit'];
    $withinLimit = strix_rate_limit_ok($pdo, strix_client_ip(), (int) $limit['max'], (int) $limit['window_seconds']);
    if (!$withinLimit) {
        strix_error(429, 'rate_limited', 'too many requests; slow down');
    }

    if ($method === 'POST' && str_ends_with($path, '/activate')) {
        strix_handle_activate($pdo, $cfg);
    }
    if ($method === 'POST' && str_ends_with($path, '/trial')) {
        strix_handle_trial($pdo, $cfg);
    }
    if ($method === 'POST' && str_ends_with($path, '/deactivate')) {
        strix_handle_deactivate($pdo);
    }
    if ($method === 'POST' && str_ends_with($path, '/refresh')) {
        strix_handle_refresh($pdo, $cfg);
    }
    if ($method === 'POST' && str_ends_with($path, '/v1/diagnostics')) {
        strix_handle_diagnostics($pdo);
    }
    if ($method === 'GET' && str_ends_with($path, '/admin/events')) {
        strix_handle_admin_events($pdo, $cfg);
    }
    if ($method === 'GET' && str_ends_with($path, '/admin/who')) {
        strix_handle_admin_who($pdo, $cfg);
    }

    strix_error(404, 'not_found', 'no such endpoint');
} catch (Throwable $e) {
    // Never leak internals (or a key) to the client; log server-side for the owner.
    error_log('[strix-activation] ' . $e->getMessage());
    strix_error(500, 'server_error', 'internal error');
}
