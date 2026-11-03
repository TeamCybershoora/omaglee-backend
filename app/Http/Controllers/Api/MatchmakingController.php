<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MatchmakingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MatchmakingController extends Controller
{
    protected MatchmakingService $matchmakingService;

    public function __construct(MatchmakingService $matchmakingService)
    {
        $this->matchmakingService = $matchmakingService;
    }

    /**
     * Create an anonymous session for a visitor.
     * POST /api/matchmaking/session
     */
    public function createSession(Request $request): JsonResponse
    {
        $data = $this->matchmakingService->createSession(
            $request->ip(),
            $request->userAgent()
        );

        return response()->json([
            'success' => true,
            'sessionUuid' => $data['session_uuid'],
            'sessionToken' => $data['raw_token'],
            'expiresAt' => $data['session']->expires_at->toIso8601String(),
        ], 201);
    }

    /**
     * Join the matchmaking waiting queue.
     * POST /api/matchmaking/start
     */
    public function start(Request $request): JsonResponse
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

        $result = $this->matchmakingService->joinQueue($session);

        if (!$result['success'] && ($result['error'] ?? null) === 'already_in_match') {
            return response()->json($result, 409);
        }

        return response()->json($result, 200);
    }

    /**
     * Poll matchmaking queue status.
     * GET /api/matchmaking/status
     */
    public function status(Request $request): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->query('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->query('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_session',
                'message' => 'Invalid or expired anonymous session credentials.',
            ], 401);
        }

        $result = $this->matchmakingService->checkStatus($session);
        return response()->json(array_merge(['success' => true], $result), 200);
    }

    /**
     * Cancel waiting in queue.
     * POST /api/matchmaking/cancel
     */
    public function cancel(Request $request): JsonResponse
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

        $result = $this->matchmakingService->cancelQueue($session);
        return response()->json($result, 200);
    }
}
