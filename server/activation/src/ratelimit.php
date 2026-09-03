<?php

/**
 * Per-IP fixed-window rate limiting for the StrixGeo activation service
 * (debt #3, contract §7).
 *
 * A fixed window keyed on (ip, window_start), where window_start is the
 * epoch-second bucket the request falls in. Each request increments the bucket
 * atomically (INSERT … ON DUPLICATE KEY UPDATE) and is refused once the bucket
 * passes the configured ceiling. Stale buckets are swept opportunistically so
 * the table never grows. This blunts licence-key guessing without any external
 * dependency (no Redis, no APCu — Combell shared hosting has neither reliably).
 */

declare(strict_types=1);

if (!defined('STRIX_ACT')) {
    http_response_code(403);
    exit('Forbidden');
}

require_once __DIR__ . '/db.php';

/**
 * Register one request from $ip and report whether it is within the limit.
 *
 * @param PDO    $pdo           The database connection.
 * @param string $ip            The client IP (the rate-limit key).
 * @param int    $max           The most requests allowed per window.
 * @param int    $windowSeconds The window length, in seconds.
 * @return bool True when the request is allowed; false when the ceiling is passed.
 */
function strix_rate_limit_ok(PDO $pdo, string $ip, int $max, int $windowSeconds): bool
{
    if ($ip === '' || $windowSeconds <= 0) {
        // No usable key / misconfiguration → do not block (fail open on the limiter
        // only; every other guard still runs).
        return true;
    }

    $now = time();
    $bucket = $now - ($now % $windowSeconds);

    // Opportunistic sweep of windows older than the previous one.
    $sweep = $pdo->prepare('DELETE FROM rate_limits WHERE window_start < :cutoff');
    $sweep->execute([':cutoff' => $bucket - $windowSeconds]);

    $bump = $pdo->prepare(
        'INSERT INTO rate_limits (ip, window_start, count) VALUES (:ip, :ws, 1) '
        . 'ON DUPLICATE KEY UPDATE count = count + 1'
    );
    $bump->execute([':ip' => $ip, ':ws' => $bucket]);

    $read = $pdo->prepare('SELECT count FROM rate_limits WHERE ip = :ip AND window_start = :ws');
    $read->execute([':ip' => $ip, ':ws' => $bucket]);
    $count = (int) $read->fetchColumn();

    return $count <= $max;
}
