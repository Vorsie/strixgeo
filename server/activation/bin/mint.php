<?php

/**
 * StrixGeo activation service — mint a licence key (debt #3, CLI only).
 *
 * Generates ONE opaque key, stores only its SHA-256 digest with the tier, holder
 * and expiry, and prints the key ONCE — it can never be recovered afterwards.
 *
 * Usage (a DATED key — a fixed end date):
 *   php bin/mint.php --tier solo --holder "Jane Doe" --email jane@firm.be \
 *       --seats 1 --expires 2027-01-01 [--notes "beta cohort 1"]
 *
 * Usage (a DURATION key — the clock starts at first activation, owner ruling
 * 2026-09-03; the key is dormant with no expiry until the tester activates it):
 *   php bin/mint.php --tier solo --holder "Jane Doe" --email jane@firm.be \
 *       --seats 1 --duration-days 30 [--notes "beta cohort 1"]
 *
 * --tier           solo | pro | studio | trial          (required)
 * --holder         who the key is for                   (required)
 * --email          holder email                         (optional)
 * --seats          device cap; default 1                (optional)
 * --expires        UTC date or datetime (e.g. 2027-01-01)  (exactly one of
 * --duration-days  N days from first activation (1..3650)   these two required)
 * --notes          free text                            (optional)
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

$opts = getopt('', ['tier:', 'holder:', 'email:', 'seats:', 'expires:', 'duration-days:', 'notes:']);

$tier = strix_cli_required($opts, 'tier');
$holder = strix_cli_required($opts, 'holder');

$validTiers = ['solo', 'pro', 'studio', 'trial'];
if (!in_array($tier, $validTiers, true)) {
    fwrite(STDERR, "error: --tier must be one of " . implode(', ', $validTiers) . "\n");
    exit(1);
}

$email = isset($opts['email']) && is_string($opts['email']) ? trim($opts['email']) : null;
$seats = isset($opts['seats']) && is_string($opts['seats']) ? max(1, (int) $opts['seats']) : 1;
$notes = isset($opts['notes']) && is_string($opts['notes']) ? $opts['notes'] : null;

// --expires (a fixed end date) and --duration-days (a clock that starts at the
// first activation) are mutually exclusive; exactly one is required. A duration
// key is minted DORMANT — duration_days set, expires_at NULL — and the server
// stamps expires_at = activation + duration_days at first activation.
$hasExpires = isset($opts['expires']) && is_string($opts['expires']) && trim($opts['expires']) !== '';
$hasDuration = isset($opts['duration-days']) && is_string($opts['duration-days']) && trim($opts['duration-days']) !== '';
if ($hasExpires === $hasDuration) {
    fwrite(STDERR, "error: provide exactly one of --expires or --duration-days\n");
    exit(1);
}

$expiresAt = null;
$durationDays = null;
if ($hasExpires) {
    try {
        $expires = new DateTimeImmutable(trim($opts['expires']), new DateTimeZone('UTC'));
    } catch (Exception $e) {
        fwrite(STDERR, "error: --expires is not a valid date/datetime (try 2027-01-01)\n");
        exit(1);
    }
    $expiresAt = $expires->format('Y-m-d H:i:s');
} else {
    // ctype_digit rejects negatives, decimals and stray characters, so only a
    // clean whole number of days reaches the range check.
    $durationRaw = trim($opts['duration-days']);
    if (!ctype_digit($durationRaw)) {
        fwrite(STDERR, "error: --duration-days must be a whole number of days (1..3650)\n");
        exit(1);
    }
    $durationDays = (int) $durationRaw;
    if ($durationDays < 1 || $durationDays > 3650) {
        fwrite(STDERR, "error: --duration-days must be from 1 to 3650\n");
        exit(1);
    }
}

$pdo = strix_db();
$key = strix_generate_key();

$insert = $pdo->prepare(
    'INSERT INTO licences (key_hash, tier, holder_name, holder_email, seats, duration_days, expires_at, notes) '
    . 'VALUES (:h, :tier, :holder, :email, :seats, :duration, :exp, :notes)'
);
$insert->execute([
    ':h' => strix_hash_key($key),
    ':tier' => $tier,
    ':holder' => $holder,
    ':email' => $email,
    ':seats' => $seats,
    ':duration' => $durationDays,
    ':exp' => $expiresAt,
    ':notes' => $notes,
]);
$id = (int) $pdo->lastInsertId();

echo "Licence minted.\n";
echo "  id:        $id\n";
echo "  tier:      $tier\n";
echo "  holder:    $holder" . ($email !== null ? " <$email>" : '') . "\n";
echo "  seats:     $seats\n";
if ($durationDays !== null) {
    echo "  duration:  $durationDays days from first activation (dormant until then; no expiry yet)\n";
} else {
    echo "  expires:   $expiresAt UTC\n";
}
echo "  key_hash:  " . substr(strix_hash_key($key), 0, 12) . "…\n";
echo "\n";
echo "  KEY (store it now — it is shown ONCE and cannot be recovered):\n";
echo "  $key\n";
