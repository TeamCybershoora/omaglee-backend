<?php

namespace App\Services;

use App\Models\AuditLog;

class AuditLogService
{
    /**
     * Record security, moderation or session audit events.
     */
    public function log(
        string $action,
        string $actorType = 'system',
        ?string $actorId = null,
        ?string $subjectType = null,
        ?string $subjectId = null,
        ?array $metadata = null
    ): AuditLog {
        return AuditLog::logEvent(
            $action,
            $actorType,
            $actorId,
            $subjectType,
            $subjectId,
            $metadata
        );
    }
}
