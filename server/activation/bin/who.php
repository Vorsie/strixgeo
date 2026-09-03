<?php

/**
 * StrixGeo activation service — "who is testing" read-out (debt #3, CLI only).
 *
 * Prints the v_who_is_testing view: one line per (licence, device) with holder,
 * tier, device label, last-seen instant and event counts — the answer to the
 * owner's "I want to see who is testing and when".
 *
 * Usage:
 *   php bin/who.php [--limit 100]
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

define('STRIX_ACT', 1);
require_once __DIR__ . '/../src/licence.php';

$opts = getopt('', ['limit:']);
$limit = isset($opts['limit']) && is_string($opts['limit']) ? max(1, (int) $opts['limit']) : 100;

$pdo = strix_db();
$stmt = $pdo->prepare('SELECT * FROM v_who_is_testing LIMIT :n');
$stmt->bindValue(':n', $limit, PDO::PARAM_INT);
$stmt->execute();
$rows = $stmt->fetchAll();

if ($rows === []) {
    echo "No licences yet.\n";
    exit(0);
}

/**
 * Pad a value to a fixed width for the plain-text table.
 *
 * @param mixed $value The cell value.
 * @param int   $width The column width.
 * @return string The padded cell.
 */
function strix_cell($value, int $width): string
{
    $text = $value === null ? '-' : (string) $value;
    if (strlen($text) > $width) {
        $text = substr($text, 0, $width - 1) . '…';
    }
    return str_pad($text, $width);
}

$header = strix_cell('holder', 22) . strix_cell('tier', 8) . strix_cell('device', 20)
    . strix_cell('last seen', 20) . strix_cell('act', 5) . strix_cell('ref', 5)
    . strix_cell('evt', 5) . 'state';
echo $header . "\n";
echo str_repeat('-', strlen($header)) . "\n";

foreach ($rows as $row) {
    $lastSeen = $row['last_refresh_at'] ?? $row['last_event_at'] ?? $row['activated_at'] ?? null;
    $state = $row['deactivated_at'] !== null ? 'deactivated'
        : ($row['revoked_at'] !== null ? 'revoked' : 'active');
    echo strix_cell($row['holder_name'], 22)
        . strix_cell($row['tier'], 8)
        . strix_cell($row['device_label'], 20)
        . strix_cell($lastSeen, 20)
        . strix_cell($row['activate_count'], 5)
        . strix_cell($row['refresh_count'], 5)
        . strix_cell($row['event_count'], 5)
        . $state . "\n";
}
