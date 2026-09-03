<?php

/**
 * Configuration loader for the StrixGeo activation service (debt #3).
 *
 * Reads the real credentials file, which lives OUTSIDE the web-served `public/`
 * directory (see docs/design/activation-server-deploy.md), so the database
 * password never sits under a URL. Resolution order:
 *
 *   1. $STRIX_ACTIVATION_CONFIG — an absolute path override (used by the
 *      conformance harness and any non-standard deploy).
 *   2. `<app root>/config.php` — the copy the owner fills from
 *      `config.example.php`. Relative to this file, that is `../config.php`
 *      (this file is `<app root>/src/config.php`).
 *
 * The result is cached for the request.
 */

declare(strict_types=1);

if (!defined('STRIX_ACT')) {
    http_response_code(403);
    exit('Forbidden');
}

/**
 * Load and cache the activation configuration array.
 *
 * @return array<string,mixed> The configuration (db, admin_token, rate_limit, …).
 * @throws RuntimeException When no configuration file can be found.
 */
function strix_load_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $candidates = [];
    $override = getenv('STRIX_ACTIVATION_CONFIG');
    if (is_string($override) && $override !== '') {
        $candidates[] = $override;
    }
    // `<app root>/config.php` — one level up from this `src/` directory.
    $candidates[] = __DIR__ . '/../config.php';

    foreach ($candidates as $path) {
        if (is_file($path)) {
            /** @var array<string,mixed> $loaded */
            $loaded = require $path;
            $config = $loaded;
            return $config;
        }
    }

    throw new RuntimeException(
        'activation config not found (looked for $STRIX_ACTIVATION_CONFIG then ../config.php)'
    );
}
