<?php

/**
 * StrixGeo activation service — revoke a licence key (debt #3, CLI only).
 *
 * Sets revoked_at on the licence whose key is given. A revoked key then reads as
 * unknown (key_unknown, 404) on every endpoint, so the client returns to the
 * activation screen at its next refresh. Existing bindings are left in place for
 * the record; nothing is deleted.
 *
 * Usage:
 *   php bin/revoke.php --key STRIX-XXXX-XXXX-XXXX-XXXX
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

define('STRIX_ACT', 1);
require_once __DIR__ . '/../src/licence.php';

$opts = getopt('', ['key:']);
if (!isset($opts['key']) || !is_string($opts['key']) || trim($opts['key']) === '') {
    fwrite(STDERR, "error: --key is required\n");
    exit(1);
}
$key = trim($opts['key']);

$pdo = strix_db();
$stmt = $pdo->prepare(
    'UPDATE licences SET revoked_at = NOW() WHERE key_hash = :h AND revoked_at IS NULL'
);
$stmt->execute([':h' => strix_hash_key($key)]);
$count = $stmt->rowCount();

if ($count === 0) {
    echo "No live licence matched that key (already revoked, or unknown).\n";
    exit(0);
}
echo "Revoked $count licence(s).\n";
