<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MatchSession extends Model
{
    protected $table = 'match_sessions';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'id',
        'status',
        'started_at',
        'ended_at',
        'ended_reason',
        'participant_a_id',
        'participant_b_id',
        'participant_a_token',
        'participant_b_token',
        'message_sequence',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
        'message_sequence' => 'integer',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isEnded(): bool
    {
        return in_array($this->status, ['ended', 'expired', 'cancelled'], true);
    }

    public function hasParticipant(string $participantId): bool
    {
        return $this->participant_a_id === $participantId || $this->participant_b_id === $participantId;
    }

    public function getRole(string $participantId): ?string
    {
        if ($this->participant_a_id === $participantId) {
            return 'initiator';
        }
        if ($this->participant_b_id === $participantId) {
            return 'receiver';
        }
        return null;
    }

    public function getOtherParticipantId(string $participantId): ?string
    {
        if ($this->participant_a_id === $participantId) {
            return $this->participant_b_id;
        }
        if ($this->participant_b_id === $participantId) {
            return $this->participant_a_id;
        }
        return null;
    }

    public function endMatch(string $reason = 'user_ended'): void
    {
        $this->update([
            'status' => 'ended',
            'ended_reason' => $reason,
            'ended_at' => now(),
        ]);
    }
}
