<?php

namespace App\Services;

use App\Models\AnonymousSession;
use App\Models\MatchmakingQueue;
use App\Models\MatchSession;
use App\Models\AuditLog;
use Illuminate\Support\Facades\Log;

class CleanupService
{
    /**
     * Run all automated cleanup routines according to configured retention policies.
     */
    public function runAll(): array
    {
        $now = now();
        $summary = [
            'expired_sessions' => 0,
            'pruned_queue_entries' => 0,
            'pruned_old_matches' => 0,
            'pruned_audit_logs' => 0,
            'executed_at' => $now->toIso8601String(),
        ];

        try {
            // 1. Expire stale or timed-out anonymous sessions
            $sessionTtl = (int) env('ANONYMOUS_SESSION_TTL', 7200);
            $sessionCutoff = $now->copy()->subSeconds($sessionTtl);

            $summary['expired_sessions'] = AnonymousSession::where('status', '!=', 'expired')
                ->where(function ($query) use ($sessionCutoff, $now) {
                    $query->where('expires_at', '<', $now)
                        ->orWhere('last_seen_at', '<', $sessionCutoff);
                })
                ->update([
                    'status' => 'expired',
                    'updated_at' => $now,
                ]);

            // 2. Remove stale queue entries (no heartbeat for > 30 seconds)
            $heartbeatCutoff = $now->copy()->subSeconds(30);
            $summary['pruned_queue_entries'] = MatchmakingQueue::where('status', 'waiting')
                ->where('last_heartbeat_at', '<', $heartbeatCutoff)
                ->delete();

            // 3. Clean up old match records older than retention window (e.g. 30 days)
            $matchRetentionDays = (int) env('MATCH_HISTORY_RETENTION_DAYS', 30);
            $matchCutoff = $now->copy()->subDays($matchRetentionDays);
            $summary['pruned_old_matches'] = MatchSession::where('status', 'ended')
                ->where('ended_at', '<', $matchCutoff)
                ->delete();

            // 4. Clean up audit logs older than retention window (e.g. 90 days)
            $auditRetentionDays = (int) env('AUDIT_LOG_RETENTION_DAYS', 90);
            $auditCutoff = $now->copy()->subDays($auditRetentionDays);
            $summary['pruned_audit_logs'] = AuditLog::where('created_at', '<', $auditCutoff)
                ->delete();

            // 5. Audit the cleanup run
            AuditLog::logEvent(
                'cleanup.executed',
                'system',
                null,
                'system',
                'automated_cleanup',
                $summary
            );

            Log::info('[CleanupService] Automated cleanup completed successfully.', $summary);
        } catch (\Throwable $e) {
            Log::error('[CleanupService] Automated cleanup error: ' . $e->getMessage());
            $summary['error'] = $e->getMessage();
        }

        return $summary;
    }
}
