<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BlockedUser;
use App\Models\MatchSession;
use App\Models\AuditLog;
use App\Services\MatchmakingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BlockController extends Controller
{
    protected MatchmakingService $matchmakingService;

    public function __construct(MatchmakingService $matchmakingService)
    {
        $this->matchmakingService = $matchmakingService;
    }

    /**
     * Block the current match stranger and terminate the session.
     * POST /api/blocks
     */
    public function store(Request $request): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->input('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->input('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_session',
                'message' => 'Valid session credentials required to block a user.',
            ], 401);
        }

        $validated = $request->validate([
            'matchId' => 'required|string|max:64',
        ]);

        $matchId = $validated['matchId'];
        $match = MatchSession::find($matchId);

        if (!$match) {
            return response()->json(['success' => false, 'error' => 'match_not_found'], 404);
        }

        // Verify that the requester is a legitimate participant in this match
        if ($match->participant_a_id !== $session->session_uuid && $match->participant_b_id !== $session->session_uuid) {
            return response()->json(['success' => false, 'error' => 'unauthorized_participant'], 403);
        }

        // Identify the other participant
        $blockedSessionUuid = ($match->participant_a_id === $session->session_uuid)
            ? $match->participant_b_id
            : $match->participant_a_id;

        if (!$blockedSessionUuid) {
            return response()->json(['success' => false, 'error' => 'no_peer_in_match'], 400);
        }

        // Idempotently record the block relationship
        BlockedUser::firstOrCreate([
            'blocker_session_uuid' => $session->session_uuid,
            'blocked_session_uuid' => $blockedSessionUuid,
        ], [
            'created_at' => now(),
        ]);

        // Automatically end the match
        if ($match->status !== 'ended') {
            $match->status = 'ended';
            $match->ended_at = now();
            $match->ended_reason = 'blocked';
            $match->save();
        }

        $session->active_match_id = null;
        $session->save();

        // Audit the block event
        AuditLog::logEvent(
            'block.created',
            'session',
            $session->session_uuid,
            'session',
            $blockedSessionUuid,
            ['match_id' => $matchId]
        );

        return response()->json([
            'success' => true,
            'message' => 'User blocked. You will not be matched with this stranger again.',
            'blockedSessionUuid' => $blockedSessionUuid,
        ], 200);
    }
}
