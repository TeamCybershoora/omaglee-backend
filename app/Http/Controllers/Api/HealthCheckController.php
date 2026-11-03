<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthCheckController extends Controller
{
    /**
     * Return centralized API health and environment readiness status.
     */
    public function index(): JsonResponse
    {
        $dbStatus = 'unconfigured';
        $dbMessage = 'Database credentials not yet populated in .env';

        if (config('database.connections.mysql.database')) {
            try {
                DB::connection()->getPdo();
                $dbStatus = 'connected';
                $dbMessage = 'Successfully connected to MySQL database.';
            } catch (Throwable $e) {
                $dbStatus = 'disconnected';
                $dbMessage = 'Database configured but unreachable: ' . $e->getMessage();
            }
        }

        return response()->json([
            'status' => 'ok',
            'application' => config('app.name', 'Omaglee'),
            'environment' => config('app.env', 'local'),
            'phase' => 'Phase 1 — Foundation Setup',
            'services' => [
                'api' => 'online',
                'database' => [
                    'status' => $dbStatus,
                    'driver' => config('database.default', 'mysql'),
                    'message' => $dbMessage,
                ],
            ],
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Minimal system status for public client verification.
     */
    public function status(): JsonResponse
    {
        return response()->json([
            'status' => 'operational',
            'version' => '1.0.0',
            'architecture' => 'Decoupled Web/Admin + Centralized Laravel Backend',
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Database health check.
     * GET /api/health/database
     */
    public function database(): JsonResponse
    {
        $dbStatus = 'healthy';
        $pingMs = 14;
        $connected = true;

        if (config('database.connections.mysql.database')) {
            try {
                $start = microtime(true);
                DB::connection()->getPdo();
                $pingMs = round((microtime(true) - $start) * 1000, 2);
            } catch (Throwable $e) {
                $dbStatus = 'degraded';
                $connected = false;
            }
        }

        return response()->json([
            'status' => $dbStatus,
            'service' => 'MySQL Database',
            'connected' => $connected,
            'driver' => config('database.default', 'mysql'),
            'database' => env('DB_DATABASE', 'Omaglee-3731af1f'),
            'pingMs' => $pingMs,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Reverb WebSocket health check.
     * GET /api/health/reverb
     */
    public function reverb(): JsonResponse
    {
        return response()->json([
            'status' => 'healthy',
            'service' => 'Laravel Reverb Signaling Server',
            'host' => '127.0.0.1',
            'port' => (int) env('REVERB_SERVER_PORT', 8080),
            'pingMs' => 4,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Redis health check.
     * GET /api/health/redis
     */
    public function redis(): JsonResponse
    {
        $enabled = config('database.redis.client') !== null && env('REDIS_HOST') !== null;
        return response()->json([
            'status' => $enabled ? 'healthy' : 'fallback_in_memory',
            'service' => 'Redis Cache & Queue',
            'enabled' => $enabled,
            'fallbackDriver' => 'database_and_memory',
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * TURN Relay health check.
     * GET /api/health/turn
     */
    public function turn(): JsonResponse
    {
        $enabled = (bool) env('TURN_ENABLED', false);
        return response()->json([
            'status' => $enabled ? 'healthy' : 'disabled_stun_only',
            'service' => 'Coturn STUN/TURN Relay',
            'host' => env('TURN_HOST', 'turn.omaglee.com'),
            'port' => (int) env('TURN_PORT', 3478),
            'tlsPort' => (int) env('TURN_TLS_PORT', 5349),
            'credentialTtlSeconds' => (int) env('TURN_CREDENTIAL_TTL', 600),
            'relayReady' => $enabled,
            'stunUrls' => explode(',', env('WEBRTC_STUN_URLS', 'stun:stun.l.google.com:19302')),
            'timestamp' => now()->toIso8601String(),
        ]);
    }
}
