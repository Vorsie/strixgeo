<?php

/**
 * Domain logic for the StrixGeo activation service (debt #3).
 *
 * The licence / device / event / trial queries the endpoints orchestrate, plus
 * the key generator and the mapping to the contract's wire licence (§3). Every
 * query is a prepared statement; the raw licence key is never stored — only its
 * SHA-256 digest — and is never written to a response body or a log line.
 *
 * Owner rulings encoded here:
 *   * 14 — 30-day offline grace, advertised on the wire licence.
 *   * 15 — the device cap is the licence's `seats` (Solo = 1).
 *   * 16 — a trial is a real, server-issued, time-limited licence.
 *   * §8 — keys are opaque random strings; the tier lives in the DB, never in
 *     the key. Format: STRIX-XXXX-XXXX-XXXX-XXXX (Crockford base32).
 */

declare(strict_types=1);

if (!defined('STRIX_ACT')) {
    http_response_code(403);
    exit('Forbidden');
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';

/** Crockford base32 alphabet (no I, L, O, U — unambiguous when read aloud). */
const STRIX_KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * SHA-256 hex digest of a licence key.
 *
 * The database stores only this; a lookup compares digests, so the raw key is
 * never string-compared (no early-exit timing leak) and a leaked DB cannot
 * activate anything.
 *
 * @param string $key The opaque licence key.
 * @return string The 64-character lowercase hex digest.
 */
function strix_hash_key(string $key): string
{
    return hash('sha256', $key);
}

/**
 * Mint a fresh opaque key: STRIX-XXXX-XXXX-XXXX-XXXX in Crockford base32.
 *
 * The tier is NOT encoded in the key (contract §8 — the DB row is the source of
 * truth); the key is a pure random identifier.
 *
 * @return string The new key.
 */
function strix_generate_key(): string
{
    $groups = [];
    $span = strlen(STRIX_KEY_ALPHABET) - 1;
    for ($g = 0; $g < 4; $g++) {
        $chunk = '';
        for ($i = 0; $i < 4; $i++) {
            $chunk .= STRIX_KEY_ALPHABET[random_int(0, $span)];
        }
        $groups[] = $chunk;
    }
    return 'STRIX-' . implode('-', $groups);
}

/**
 * Find a live (non-revoked) licence by its key.
 *
 * A revoked key reads as absent — the contract has no "revoked" code, and an
 * unknown key is the closest honest answer (the client returns to activation).
 *
 * @param PDO    $pdo The database connection.
 * @param string $key The opaque licence key.
 * @return array<string,mixed>|null The licence row, or null when unknown/revoked.
 */
function strix_find_licence(PDO $pdo, string $key): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM licences WHERE key_hash = :h AND revoked_at IS NULL LIMIT 1'
    );
    $stmt->execute([':h' => strix_hash_key($key)]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/**
 * Count the ACTIVE device bindings on a licence (deactivated seats excluded).
 *
 * @param PDO $pdo       The database connection.
 * @param int $licenceId The licence id.
 * @return int The number of currently-bound devices.
 */
function strix_active_device_count(PDO $pdo, int $licenceId): int
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM devices WHERE licence_id = :l AND deactivated_at IS NULL'
    );
    $stmt->execute([':l' => $licenceId]);
    return (int) $stmt->fetchColumn();
}

/**
 * Fetch the binding row for one (licence, device) pair, active or not.
 *
 * @param PDO    $pdo       The database connection.
 * @param int    $licenceId The licence id.
 * @param string $deviceId  The client device id.
 * @return array<string,mixed>|null The device row, or null when never bound.
 */
function strix_find_device(PDO $pdo, int $licenceId, string $deviceId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM devices WHERE licence_id = :l AND device_id = :d LIMIT 1'
    );
    $stmt->execute([':l' => $licenceId, ':d' => $deviceId]);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/**
 * Bind a device to a licence, or re-activate / refresh an existing binding.
 *
 * Idempotent per (licence, device): a second activate of the same device reuses
 * the row (never a new seat, contract §6) and bumps last_refresh_at; a
 * previously-deactivated row is re-activated in place.
 *
 * @param PDO    $pdo       The database connection.
 * @param int    $licenceId The licence id.
 * @param string $deviceId  The client device id.
 * @param string $label     The device label (hostname).
 * @return array<string,mixed> The (re-)loaded device row, including its id.
 */
function strix_bind_device(PDO $pdo, int $licenceId, string $deviceId, string $label): array
{
    $existing = strix_find_device($pdo, $licenceId, $deviceId);
    if ($existing === null) {
        $insert = $pdo->prepare(
            'INSERT INTO devices (licence_id, device_id, device_label, activated_at, last_refresh_at) '
            . 'VALUES (:l, :d, :lbl, NOW(), NOW())'
        );
        $insert->execute([':l' => $licenceId, ':d' => $deviceId, ':lbl' => $label]);
    } else {
        // Re-activate (clear any deactivation), refresh the label + timestamps.
        // MySQL evaluates SET clauses left-to-right using ALREADY-updated values,
        // so the activated_at CASE must read deactivated_at BEFORE the clause that
        // nulls it — otherwise it always sees NULL and never re-stamps a
        // previously-released binding's activation time.
        $update = $pdo->prepare(
            'UPDATE devices SET device_label = :lbl, '
            . 'activated_at = CASE WHEN deactivated_at IS NULL THEN activated_at ELSE NOW() END, '
            . 'deactivated_at = NULL, last_refresh_at = NOW() '
            . 'WHERE id = :id'
        );
        $update->execute([':lbl' => $label, ':id' => $existing['id']]);
    }
    /** @var array<string,mixed> $row */
    $row = strix_find_device($pdo, $licenceId, $deviceId);
    return $row;
}

/**
 * Bump last_refresh_at on an existing binding (the /refresh path).
 *
 * @param PDO $pdo      The database connection.
 * @param int $deviceRowId The devices.id to touch.
 * @return void
 */
function strix_touch_refresh(PDO $pdo, int $deviceRowId): void
{
    $stmt = $pdo->prepare('UPDATE devices SET last_refresh_at = NOW() WHERE id = :id');
    $stmt->execute([':id' => $deviceRowId]);
}

/**
 * Deactivate every ACTIVE binding a device holds, across all licences.
 *
 * @param PDO    $pdo      The database connection.
 * @param string $deviceId The client device id.
 * @return int The number of active bindings that were released.
 */
function strix_deactivate_device(PDO $pdo, string $deviceId): int
{
    $stmt = $pdo->prepare(
        'UPDATE devices SET deactivated_at = NOW() WHERE device_id = :d AND deactivated_at IS NULL'
    );
    $stmt->execute([':d' => $deviceId]);
    return $stmt->rowCount();
}

/**
 * Whether the server holds ANY binding row for a device (active or released).
 *
 * Distinguishes "already released → 200 no-op" from "never seen → 404" on
 * /deactivate (contract §4/§6).
 *
 * @param PDO    $pdo      The database connection.
 * @param string $deviceId The client device id.
 * @return bool True when at least one binding row exists for the device.
 */
function strix_device_known(PDO $pdo, string $deviceId): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM devices WHERE device_id = :d LIMIT 1');
    $stmt->execute([':d' => $deviceId]);
    return $stmt->fetchColumn() !== false;
}

/**
 * Whether a device has ever consumed a trial (one trial per device, ruling 16).
 *
 * A deactivated trial device still counts — otherwise deactivating a trial would
 * grant an unlimited supply of them.
 *
 * @param PDO    $pdo      The database connection.
 * @param string $deviceId The client device id.
 * @return bool True when the device already holds a trial binding.
 */
function strix_device_has_trial(PDO $pdo, string $deviceId): bool
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM devices d JOIN licences l ON l.id = d.licence_id '
        . "WHERE d.device_id = :d AND l.tier = 'trial' LIMIT 1"
    );
    $stmt->execute([':d' => $deviceId]);
    return $stmt->fetchColumn() !== false;
}

/**
 * Mint a trial licence bound to a device and return the licence row + raw key.
 *
 * @param PDO    $pdo       The database connection.
 * @param string $deviceId  The client device id.
 * @param string $label     The device label (also used as the holder name).
 * @param int    $trialDays The trial length, in days.
 * @return array{row: array<string,mixed>, key: string} The stored row and the one-time key.
 */
function strix_mint_trial(PDO $pdo, string $deviceId, string $label, int $trialDays): array
{
    $key = strix_generate_key();
    $expiresAt = strix_ms_to_dt(strix_now_ms() + $trialDays * STRIX_DAY_MS);
    $holder = $label !== '' ? $label : 'trial device';

    $insert = $pdo->prepare(
        'INSERT INTO licences (key_hash, tier, holder_name, holder_email, seats, expires_at, notes) '
        . "VALUES (:h, 'trial', :holder, NULL, 1, :exp, :notes)"
    );
    $insert->execute([
        ':h' => strix_hash_key($key),
        ':holder' => $holder,
        ':exp' => $expiresAt,
        ':notes' => 'server-issued trial for device ' . $deviceId,
    ]);
    $licenceId = (int) $pdo->lastInsertId();

    strix_bind_device($pdo, $licenceId, $deviceId, $label);

    $load = $pdo->prepare('SELECT * FROM licences WHERE id = :id');
    $load->execute([':id' => $licenceId]);
    /** @var array<string,mixed> $row */
    $row = $load->fetch();
    return ['row' => $row, 'key' => $key];
}

/**
 * Record one activation event (contract: a row for EVERY call, incl. refusals).
 *
 * @param PDO                 $pdo       The database connection.
 * @param int|null            $licenceId The licence id, or null (unknown-key refusal).
 * @param string              $deviceId  The client device id.
 * @param string              $kind      One of activate/refresh/deactivate/trial/refused.
 * @param array<string,mixed> $detail    Extra context (refusal code, tier, …) stored as JSON.
 * @return void
 */
function strix_log_event(PDO $pdo, ?int $licenceId, string $deviceId, string $kind, array $detail): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO activation_events (licence_id, device_id, kind, ip, user_agent, detail) '
        . 'VALUES (:l, :d, :k, :ip, :ua, :detail)'
    );
    $stmt->execute([
        ':l' => $licenceId,
        ':d' => $deviceId,
        ':k' => $kind,
        ':ip' => strix_client_ip(),
        ':ua' => strix_user_agent(),
        ':detail' => $detail === [] ? null : json_encode($detail, JSON_UNESCAPED_SLASHES),
    ]);
}

/**
 * Build the contract's wire licence (§3) from a stored licence row.
 *
 * The wire `expiresAt` is min(row.expires_at, now + refresh horizon): each
 * refresh rolls it forward (resetting the client's grace clock) but never past
 * the licence's own end — which caps a cancelled subscription's runway and lets
 * a trial count down to its real end. `seatId` is derived from the device row id
 * so it is stable across refreshes. `key` is the raw key the caller supplied
 * (echoed, never stored) — for a trial, the freshly minted key.
 *
 * @param array<string,mixed> $licenceRow The licences row.
 * @param string              $key        The raw key to echo.
 * @param array<string,mixed> $deviceRow  The devices row (for the stable seatId + label).
 * @param string              $deviceLabel The device label to echo.
 * @param int                 $graceDays   The offline grace to advertise (ruling 14).
 * @param int                 $horizonDays The rolling refresh horizon, in days.
 * @return array<string,mixed> The wire licence, wrapped under no key here (caller wraps).
 */
function strix_wire_licence(
    array $licenceRow,
    string $key,
    array $deviceRow,
    string $deviceLabel,
    int $graceDays,
    int $horizonDays
): array {
    $nowMs = strix_now_ms();
    $hardEndMs = strix_dt_to_ms((string) $licenceRow['expires_at']);
    $rollingMs = $nowMs + $horizonDays * STRIX_DAY_MS;
    $expiresAtMs = min($hardEndMs, $rollingMs);

    // The DB keeps 'trial' as a real tier (the owner's records / trial analytics),
    // but the WIRE tier MUST be one of solo|pro|studio — the client rejects any
    // other value (contract §3). A trial therefore travels as a solo-tier licence
    // with isTrial=true, exactly as the contract's /trial section (§4) and the dev
    // stub already present it.
    $dbTier = (string) $licenceRow['tier'];
    $isTrial = $dbTier === 'trial';
    $wireTier = $isTrial ? 'solo' : $dbTier;

    return [
        'key' => $key,
        'tier' => $wireTier,
        'seatId' => 'seat_' . (string) $deviceRow['id'],
        'isTrial' => $isTrial,
        'issuedAt' => $nowMs,
        'expiresAt' => $expiresAtMs,
        'graceDays' => $graceDays,
        'deviceId' => (string) $deviceRow['device_id'],
        'deviceLabel' => $deviceLabel,
    ];
}
