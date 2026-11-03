<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class AnonymousSession extends Model
{
    protected $table = 'anonymous_sessions';

    protected $fillable = [
        'session_uuid',
        'token_hash',
        'status',
        'active_match_id',
        'ip_address',
        'user_agent',
        'last_seen_at',
        'expires_at',
    ];

    protected $casts = [
        'last_seen_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    /**
     * Create a new secure anonymous session with a cryptographically strong token.
     * Returns an array with ['session' => $session, 'raw_token' => $token]
     */
    public static function createSecureSession(?string $ip = null, ?string $userAgent = null): array
    {
        $sessionUuid = 'anon_' . Str::random(32);
        $rawToken = Str::random(64);
        $tokenHash = hash('sha256', $rawToken);

        $session = static::create([
            'session_uuid' => $sessionUuid,
            'token_hash' => $tokenHash,
            'status' => 'idle',
            'ip_address' => $ip,
            'user_agent' => $userAgent ? Str::limit($userAgent, 500) : null,
            'last_seen_at' => now(),
            'expires_at' => now()->addHours(24),
        ]);

        return [
            'session' => $session,
            'session_uuid' => $sessionUuid,
            'raw_token' => $rawToken,
        ];
    }

    /**
     * Verify whether a raw token matches this session's token hash.
     */
    public function verifyToken(string $rawToken): bool
    {
        return hash_equals($this->token_hash, hash('sha256', $rawToken));
    }

    /**
     * Check if this session is expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at && $this->expires_at->isPast();
    }

    /**
     * Update activity timestamp.
     */
    public function touchActivity(): void
    {
        $this->update(['last_seen_at' => now()]);
    }
}
