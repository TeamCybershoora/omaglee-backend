<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MatchSession;
use App\Services\MatchmakingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MatchLifecycleController extends Controller
{
    protected MatchmakingService $matchmakingService;

    public function __construct(MatchmakingService $matchmakingService)
    {
        $this->matchmakingService = $matchmakingService;
    }

    /**
     * Skip/Next stranger: Invalidate old match and immediately enter queue.
     * POST /api/matches/{matchId}/next
     */
    public function next(Request $request, string $matchId): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->input('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->input('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_session',
                'message' => 'Invalid or expired anonymous session credentials.',
            ], 401);
        }

        $result = $this->matchmakingService->nextMatch($session, $matchId);
        return response()->json($result, 200);
    }

    /**
     * Gracefully end match / disconnect.
     * POST /api/matches/{matchId}/disconnect
     */
    public function disconnect(Request $request, string $matchId): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->input('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->input('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_session',
                'message' => 'Invalid or expired anonymous session credentials.',
            ], 401);
        }

        $result = $this->matchmakingService->disconnectMatch($session, $matchId, 'disconnect');
        return response()->json($result, 200);
    }

    /**
     * Match heartbeat to maintain active session.
     * POST /api/matches/{matchId}/heartbeat
     */
    public function heartbeat(Request $request, string $matchId): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->input('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->input('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json(['success' => false, 'error' => 'invalid_session'], 401);
        }

        $match = MatchSession::where('id', $matchId)->first();
        if (!$match || $match->isEnded()) {
            return response()->json(['success' => false, 'error' => 'match_ended'], 410);
        }

        return response()->json([
            'success' => true,
            'matchId' => $matchId,
            'status' => $match->status,
        ], 200);
    }

    /**
     * Get match status.
     * GET /api/matches/{matchId}/status
     */
    public function status(Request $request, string $matchId): JsonResponse
    {
        $match = MatchSession::where('id', $matchId)->first();
        if (!$match) {
            return response()->json(['success' => false, 'error' => 'match_not_found'], 404);
        }

        return response()->json([
            'success' => true,
            'matchId' => $matchId,
            'status' => $match->status,
            'endedReason' => $match->ended_reason,
            'startedAt' => $match->started_at,
            'endedAt' => $match->ended_at,
        ], 200);
    }
}
