<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AnonymousSession;
use App\Models\MatchSession;
use App\Models\MatchmakingQueue;
use App\Models\Report;
use App\Models\AuditLog;
use App\Services\CleanupService;
use App\Services\RedisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SystemController extends Controller
{
    protected CleanupService $cleanupService;
    protected RedisService $redisService;

    public function __construct(CleanupService $cleanupService, RedisService $redisService)
    {
        $this->cleanupService = $cleanupService;
        $this->redisService = $redisService;
    }

    /**
     * Get aggregated system persistence & session statistics.
     * GET /api/system/stats
     */
    public function stats(): JsonResponse
    {
        $activeSessions = AnonymousSession::where('status', 'idle')
            ->orWhere('status', 'waiting')
            ->orWhere('status', 'matched')
            ->count();

        $activeMatches = MatchSession::where('status', 'active')->count();
        $waitingQueueCount = MatchmakingQueue::where('status', 'waiting')->count();
        $totalReports = Report::count();
        $recentAuditLogs = AuditLog::count();

        return response()->json([
            'success' => true,
            'database' => [
                'activeSessions' => $activeSessions,
                'activeMatches' => $activeMatches,
                'waitingQueue' => $waitingQueueCount,
                'totalReports' => $totalReports,
                'auditLogsCount' => $recentAuditLogs,
            ],
            'redis' => [
                'enabled' => $this->redisService->isEnabled(),
                'status' => $this->redisService->ping() ? 'connected' : 'offline_or_fallback',
            ],
            'retentionPolicies' => [
                'anonymousSessionTtlSeconds' => (int) env('ANONYMOUS_SESSION_TTL', 7200),
                'matchHistoryDays' => (int) env('MATCH_HISTORY_RETENTION_DAYS', 30),
                'auditLogDays' => (int) env('AUDIT_LOG_RETENTION_DAYS', 90),
            ],
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Run manual cleanup job (authorized).
     * POST /api/cleanup/run
     */
    public function runCleanup(Request $request): JsonResponse
    {
        $summary = $this->cleanupService->runAll();

        return response()->json([
            'success' => true,
            'message' => 'Automated cleanup routine executed.',
            'summary' => $summary,
        ]);
    }
}
