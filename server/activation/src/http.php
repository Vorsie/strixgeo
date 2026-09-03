<?php

/**
 * HTTP request/response helpers for the StrixGeo activation service (debt #3).
 *
 * Everything the front controller needs to speak the contract's JSON wire:
 * reading and validating the request body, emitting the uniform success/error
 * shapes (contract §5), resolving the client IP, and the epoch-millisecond clock
 * (contract §1). No secret — never the licence key — is ever placed in a
 * response body or a log line here.
 */

declare(strict_types=1);

if (!defined('STRIX_ACT')) {
    http_response_code(403);
    exit('Forbidden');
}

/** Milliseconds in a day — the wire carries the offline grace as a whole-day count. */
const STRIX_DAY_MS = 86400000;

// str_ends_with polyfill for a PHP < 8.0 host (Combell is 8.x; this is belt).
if (!function_exists('str_ends_with')) {
    /**
     * @param string $haystack The string to test.
     * @param string $needle   The suffix to look for.
     * @return bool True when $haystack ends with $needle.
     */
    function str_ends_with(string $haystack, string $needle): bool
    {
        if ($needle === '') {
            return true;
        }
        return substr($haystack, -strlen($needle)) === $needle;
    }
}

// array_is_list polyfill for a PHP < 8.1 host (added in 8.1).
if (!function_exists('array_is_list')) {
    /**
     * @param array<mixed> $array The array to test.
     * @return bool True when the array has sequential 0..n-1 integer keys.
     */
    function array_is_list(array $array): bool
    {
        if ($array === []) {
            return true;
        }
        return array_keys($array) === range(0, count($array) - 1);
    }
}

/**
 * Current time as integer milliseconds since the Unix epoch, UTC (contract §1).
 *
 * @return int Epoch milliseconds.
 */
function strix_now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

/**
 * Convert a UTC 'Y-m-d H:i:s' DATETIME to epoch milliseconds.
 *
 * @param string $datetime A MySQL DATETIME string, interpreted as UTC.
 * @return int Epoch milliseconds.
 */
function strix_dt_to_ms(string $datetime): int
{
    $dt = new DateTimeImmutable($datetime, new DateTimeZone('UTC'));
    return $dt->getTimestamp() * 1000;
}

/**
 * Convert epoch milliseconds to a UTC 'Y-m-d H:i:s' DATETIME string.
 *
 * @param int $ms Epoch milliseconds.
 * @return string A MySQL DATETIME string in UTC.
 */
function strix_ms_to_dt(int $ms): string
{
    $dt = (new DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone(new DateTimeZone('UTC'));
    return $dt->format('Y-m-d H:i:s');
}

/**
 * Send a JSON response and end the request.
 *
 * @param int                 $status HTTP status code.
 * @param array<string,mixed> $body   The JSON body.
 * @return never
 */
function strix_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send the contract's uniform error body (§5) and end the request.
 *
 * `message` is a fallback log/display string and MUST NOT echo the licence key.
 *
 * @param int    $status  HTTP status code.
 * @param string $code    The machine-readable error code from the vocabulary.
 * @param string $message A human-readable detail carrying no secret.
 * @return never
 */
function strix_error(int $status, string $code, string $message): void
{
    strix_json($status, ['error' => ['code' => $code, 'message' => $message]]);
}

/**
 * Read the raw request body, refusing anything larger than a cap.
 *
 * Used by the diagnostics endpoint (512 KiB cap → 413). Returns the raw bytes;
 * the caller decides whether to JSON-decode.
 *
 * @param int $maxBytes The largest body to accept, in bytes.
 * @return string|null The raw body, or null when it exceeds $maxBytes.
 */
function strix_read_raw_body(int $maxBytes): ?string
{
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        return '';
    }
    if (strlen($raw) > $maxBytes) {
        return null;
    }
    return $raw;
}

/**
 * Read and JSON-decode the request body as an object.
 *
 * Returns the decoded associative array, or null when the body is missing or not
 * a JSON object (the caller maps null to a 400 bad_request).
 *
 * @return array<string,mixed>|null The decoded object, or null.
 */
function strix_read_json_object(): ?array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || array_is_list($decoded)) {
        return null;
    }
    /** @var array<string,mixed> $decoded */
    return $decoded;
}

/**
 * Read a required, bounded, non-empty string field from a decoded body.
 *
 * @param array<string,mixed> $body   The decoded request body.
 * @param string              $field  The field name.
 * @param int                 $maxLen The largest length accepted.
 * @return string|null The trimmed value, or null when missing/empty/oversized/non-string.
 */
function strix_string_field(array $body, string $field, int $maxLen = 191): ?string
{
    if (!isset($body[$field]) || !is_string($body[$field])) {
        return null;
    }
    $value = trim($body[$field]);
    if ($value === '' || strlen($value) > $maxLen) {
        return null;
    }
    return $value;
}

/**
 * Read an optional, bounded string field, defaulting when absent.
 *
 * @param array<string,mixed> $body    The decoded request body.
 * @param string              $field   The field name.
 * @param string              $default The value to return when absent/invalid.
 * @param int                 $maxLen  The largest length accepted.
 * @return string The value or the default.
 */
function strix_optional_string(array $body, string $field, string $default = '', int $maxLen = 191): string
{
    if (!isset($body[$field]) || !is_string($body[$field])) {
        return $default;
    }
    $value = trim($body[$field]);
    if ($value === '' || strlen($value) > $maxLen) {
        return $default;
    }
    return $value;
}

/**
 * Resolve the client IP, honouring a single proxy hop on shared hosting.
 *
 * @return string The best-guess client IP (bounded to 45 chars for the column).
 */
function strix_client_ip(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (is_string($forwarded) && $forwarded !== '') {
        // The left-most entry is the original client on a well-behaved proxy.
        $first = trim(explode(',', $forwarded)[0]);
        if ($first !== '') {
            return substr($first, 0, 45);
        }
    }
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    return substr(is_string($remote) ? $remote : '', 0, 45);
}

/**
 * The request's User-Agent, bounded to the column width.
 *
 * @return string|null The User-Agent, or null when absent.
 */
function strix_user_agent(): ?string
{
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    if (!is_string($ua) || $ua === '') {
        return null;
    }
    return substr($ua, 0, 255);
}

/**
 * Whether the request arrived over HTTPS, honouring a terminating proxy.
 *
 * @return bool True when the request is HTTPS.
 */
function strix_is_https(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    if (is_string($https) && $https !== '' && strtolower($https) !== 'off') {
        return true;
    }
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') {
        return true;
    }
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    return is_string($proto) && strtolower($proto) === 'https';
}
