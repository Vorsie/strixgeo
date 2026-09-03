<?php

/**
 * StrixGeo activation service — configuration TEMPLATE (debt #3).
 *
 * Copy this file to `config.php` (one level up from the web-served `public/`
 * directory — see docs/design/activation-server-deploy.md) and fill in the real
 * values. `src/config.php` loads it; nothing under `public/` ever holds the
 * database password.
 *
 * The `defined('STRIX_ACT')` guard makes a direct web hit on this file 403
 * instead of executing it — belt-and-braces on top of keeping it outside the
 * webroot and the `.htaccess` deny rule.
 */

declare(strict_types=1);

if (!defined('STRIX_ACT')) {
    http_response_code(403);
    exit('Forbidden');
}

return [
    // MySQL connection. On Combell shared hosting `host` is usually the database
    // server name from the panel (often 'localhost' when the DB is on the same
    // host), and name/user are the panel-created database + user.
    'db' => [
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => 'strix_activation',
        'user'     => 'strix_activation',
        'password' => 'CHANGE_ME',
        'charset'  => 'utf8mb4',
    ],

    // Guards GET /admin/events and GET /admin/who. A long random string; compared
    // with hash_equals(). Keep it secret — it exposes who is testing.
    // Generate one, e.g.: php -r "echo bin2hex(random_bytes(24)), PHP_EOL;"
    'admin_token' => 'CHANGE_ME_LONG_RANDOM_ADMIN_TOKEN',

    // Per-IP fixed-window rate limit (contract §7). 60 requests / 10 minutes is
    // ample for a single beta seat and blunts key-guessing.
    'rate_limit' => [
        'max'            => 60,
        'window_seconds' => 600,
    ],

    // Trial length, in days (owner ruling 16: a server-issued 30-day trial).
    'trial_days' => 30,

    // Offline grace the licence advertises to the client, in whole days
    // (owner ruling 14). The client opens offline while now < expiresAt + grace.
    'grace_days' => 30,

    // The rolling refresh horizon, in days. The wire `expiresAt` returned by
    // /activate and /refresh is min(licence.expires_at, now + this). So each
    // successful refresh rolls the authoritative end forward (resetting the
    // client's grace clock), but never past the licence's own expires_at — which
    // is what caps a cancelled/expired subscription's runway and makes a trial
    // count down to its real end. Deploy note: mint paid keys with a FAR
    // expires_at so this horizon (not the mint date) drives the wire value.
    'refresh_horizon_days' => 30,

    // Refuse non-HTTPS requests (contract §1). The .htaccess also force-redirects
    // http->https; this is the app-level backstop. Set STRIX_ALLOW_INSECURE=1 in
    // the environment to bypass for a local `php -S` smoke test only.
    'require_https' => true,
];
