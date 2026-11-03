<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MatchParticipant extends Model
{
    use HasFactory;

    protected $table = 'match_participants';

    protected $fillable = [
        'match_id',
        'anonymous_session_id',
        'session_uuid',
        'user_id',
        'role',
        'participant_token_hash',
        'participant_status',
        'joined_at',
        'disconnected_at',
    ];

    protected $casts = [
        'joined_at' => 'datetime',
        'disconnected_at' => 'datetime',
    ];

    public function matchSession(): BelongsTo
    {
        return $this->belongsTo(MatchSession::class, 'match_id', 'id');
    }

    public function anonymousSession(): BelongsTo
    {
        return $this->belongsTo(AnonymousSession::class, 'anonymous_session_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
