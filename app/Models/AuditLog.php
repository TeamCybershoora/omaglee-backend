<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    use HasFactory;

    protected $table = 'audit_logs';

    public $timestamps = false;

    protected $fillable = [
        'actor_type',
        'actor_id',
        'action',
        'subject_type',
        'subject_id',
        'metadata',
        'created_at',
    ];

    protected $casts = [
        'metadata' => 'array',
        'created_at' => 'datetime',
    ];

    /**
     * Helper to write an audit log entry with strict sanitization (no credentials/tokens).
     */
    public static function logEvent(
        string $action,
        string $actorType = 'system',
        ?string $actorId = null,
        ?string $subjectType = null,
        ?string $subjectId = null,
        ?array $metadata = null
    ): self {
        // Sanitize metadata to ensure secrets are never stored in audit logs
        $sanitizedMetadata = null;
        if ($metadata) {
            $blockedKeys = ['password', 'token', 'raw_token', 'secret', 'turn_secret', 'app_key', 'reverb_secret'];
            $sanitizedMetadata = array_filter($metadata, function ($key) use ($blockedKeys) {
                return !in_array(strtolower($key), $blockedKeys);
            }, ARRAY_FILTER_USE_KEY);
        }

        return static::create([
            'actor_type' => $actorType,
            'actor_id' => $actorId,
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'metadata' => $sanitizedMetadata,
            'created_at' => now(),
        ]);
    }
}
