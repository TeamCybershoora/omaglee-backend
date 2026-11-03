<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MatchmakingQueue extends Model
{
    protected $table = 'matchmaking_queue';

    protected $fillable = [
        'session_uuid',
        'status',
        'match_id',
        'joined_at',
        'last_heartbeat_at',
        'reserved_at',
        'expires_at',
    ];

    protected $casts = [
        'joined_at' => 'datetime',
        'last_heartbeat_at' => 'datetime',
        'reserved_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    public function isWaiting(): bool
    {
        return $this->status === 'waiting';
    }

    public function isMatched(): bool
    {
        return $this->status === 'matched';
    }

    public function isExpired(): bool
    {
        return $this->status === 'expired' || ($this->expires_at && $this->expires_at->isPast());
    }
}
