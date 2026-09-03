<?php

/**
 * StrixGeo activation service — mint a licence key (debt #3, CLI only).
 *
 * Generates ONE opaque key, stores only its SHA-256 digest with the tier, holder
 * and expiry, and prints the key ONCE — it can never be recovered afterwards.
 *
 * Usage:
 *   php bin/mint.php --tier solo --holder "Jane Doe" --email jane@firm.be \
 *       --seats 1 --expires 2027-01-01 [--notes "beta cohort 1"]
 *
 * --tier     solo | pro | studio | trial   (required)
 * --holder   who the key is for            (required)
 * --email    holder email                  (optional)
 * --seats    device cap; default 1         (optional)
 * --expires  UTC date or datetime          (required; e.g. 2027-01-01)
 * --notes    free text                      (optional)
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

define('STRIX_ACT', 1);
require_once __DIR__ . '/../src/licence.php';

/**
 * Read a required CLI option or exit with an error.
 *
 * @param array<string,mixed> $opts The parsed getopt map.
 * @param string              $name The option name.
 * @return string The value.
 */
function strix_cli_required(array $opts, string $name): string
{
    if (!isset($opts[$name]) || !is_string($opts[$name]) || trim($opts[$name]) === '') {
        fwrite(STDERR, "error: --$name is required\n");
        exit(1);
    }
    return trim($opts[$name]);
}

$opts = getopt('', ['tier:', 'holder:', 'email::', 'seats::', 'expires:', 'notes::']);

$tier = strix_cli_required($opts, 'tier');
$holder = strix_cli_required($opts, 'holder');
$expiresRaw = strix_cli_required($opts, 'expires');

$validTiers = ['solo', 'pro', 'studio', 'trial'];
if (!in_array($tier, $validTiers, true)) {
    fwrite(STDERR, "error: --tier must be one of " . implode(', ', $validTiers) . "\n");
    exit(1);
}

$email = isset($opts['email']) && is_string($opts['email']) ? trim($opts['email']) : null;
$seats = isset($opts['seats']) && is_string($opts['seats']) ? max(1, (int) $opts['seats']) : 1;
$notes = isset($opts['notes']) && is_string($opts['notes']) ? $opts['notes'] : null;

try {
    $expires = new DateTimeImmutable($expiresRaw, new DateTimeZone('UTC'));
} catch (Exception $e) {
    fwrite(STDERR, "error: --expires is not a valid date/datetime (try 2027-01-01)\n");
    exit(1);
}
$expiresAt = $expires->format('Y-m-d H:i:s');

$pdo = strix_db();
$key = strix_generate_key();

$insert = $pdo->prepare(
    'INSERT INTO licences (key_hash, tier, holder_name, holder_email, seats, expires_at, notes) '
    . 'VALUES (:h, :tier, :holder, :email, :seats, :exp, :notes)'
);
$insert->execute([
    ':h' => strix_hash_key($key),
    ':tier' => $tier,
    ':holder' => $holder,
    ':email' => $email,
    ':seats' => $seats,
    ':exp' => $expiresAt,
    ':notes' => $notes,
]);
$id = (int) $pdo->lastInsertId();

echo "Licence minted.\n";
echo "  id:        $id\n";
echo "  tier:      $tier\n";
echo "  holder:    $holder" . ($email !== null ? " <$email>" : '') . "\n";
echo "  seats:     $seats\n";
echo "  expires:   $expiresAt UTC\n";
echo "  key_hash:  " . substr(strix_hash_key($key), 0, 12) . "…\n";
echo "\n";
echo "  KEY (store it now — it is shown ONCE and cannot be recovered):\n";
echo "  $key\n";
