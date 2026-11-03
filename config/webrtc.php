<?php

return [
    /*
    |--------------------------------------------------------------------------
    | WebRTC STUN Servers Configuration
    |--------------------------------------------------------------------------
    | Comma-separated list of STUN server URLs for discovering public network mappings.
    */
    'stun_urls' => env('WEBRTC_STUN_URLS', 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'),

    /*
    |--------------------------------------------------------------------------
    | WebRTC TURN Server Relay Configuration (coturn / REST API compatible)
    |--------------------------------------------------------------------------
    | Supports short-lived HMAC-SHA1 credentials via shared secret.
    */
    'turn' => [
        'enabled' => (bool) env('TURN_ENABLED', false),
        'host' => env('TURN_HOST', 'turn.omaglee.com'),
        'port' => (int) env('TURN_PORT', 3478),
        'tls_port' => (int) env('TURN_TLS_PORT', 5349),
        'secret' => env('TURN_SECRET', 'omaglee-turn-shared-secret-key-32ch'),
        'ttl' => (int) env('TURN_CREDENTIAL_TTL', 600), // 10 minutes
        'tls_enabled' => (bool) env('TURN_TLS_ENABLED', false),
    ],
];
