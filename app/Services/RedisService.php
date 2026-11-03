<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class RedisService
{
    protected bool $enabled;
    protected string $prefix;

    public function __construct()
    {
        $this->enabled = (bool) env('REDIS_ENABLED', false);
        $this->prefix = env('REDIS_PREFIX', 'omaglee:');
    }

    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    /**
     * Check if Redis server is reachable.
     */
    public function ping(): bool
    {
        if (!$this->enabled) return false;

        try {
            return Redis::ping() === 'PONG' || Redis::ping() === true;
        } catch (\Throwable $e) {
            Log::warning('[RedisService] Redis ping failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Store temporary presence for session with short TTL.
     */
    public function setPresence(string $sessionUuid, int $ttlSeconds = 60): bool
    {
        if (!$this->enabled) return true; // Graceful fallback

        try {
            Redis::setex("{$this->prefix}session:{$sessionUuid}:presence", $ttlSeconds, time());
            return true;
        } catch (\Throwable $e) {
            Log::warning('[RedisService] setPresence failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if session is actively present.
     */
    public function isPresent(string $sessionUuid): bool
    {
        if (!$this->enabled) return true; // Assume present if Redis disabled

        try {
            return (bool) Redis::exists("{$this->prefix}session:{$sessionUuid}:presence");
        } catch (\Throwable $e) {
            return true;
        }
    }

    /**
     * Acquire a short-lived atomic distributed lock for matchmaking or match transition.
     */
    public function acquireLock(string $lockKey, int $ttlSeconds = 5): bool
    {
        if (!$this->enabled) return true;

        try {
            // SET key value NX EX seconds
            return (bool) Redis::set("{$this->prefix}lock:{$lockKey}", '1', 'EX', $ttlSeconds, 'NX');
        } catch (\Throwable $e) {
            return true;
        }
    }

    /**
     * Release atomic distributed lock.
     */
    public function releaseLock(string $lockKey): void
    {
        if (!$this->enabled) return;

        try {
            Redis::del("{$this->prefix}lock:{$lockKey}");
        } catch (\Throwable $e) {
            // Non-fatal
        }
    }

    /**
     * Increment rate limit counter.
     */
    public function hitRateLimit(string $key, int $windowSeconds = 60): int
    {
        if (!$this->enabled) return 1;

        try {
            $fullKey = "{$this->prefix}ratelimit:{$key}";
            $count = Redis::incr($fullKey);
            if ($count === 1) {
                Redis::expire($fullKey, $windowSeconds);
            }
            return (int) $count;
        } catch (\Throwable $e) {
            return 1;
        }
    }
}
