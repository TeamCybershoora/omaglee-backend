<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Models\MatchSession;
use App\Models\AuditLog;
use App\Services\MatchmakingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ReportController extends Controller
{
    protected MatchmakingService $matchmakingService;

    public function __construct(MatchmakingService $matchmakingService)
    {
        $this->matchmakingService = $matchmakingService;
    }

    /**
     * Submit an abuse/safety report for the active stranger.
     * Derives reported participant server-side from authorized match.
     * POST /api/reports
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
                'message' => 'Valid session credentials required to file a report.',
            ], 401);
        }

        $validated = $request->validate([
            'matchId' => 'required|string|max:64',
            'reason' => 'required|string|in:inappropriate,nudity_explicit,harassment_abuse,spam_advertising,threats_intimidation,suspected_scam,underage_concern,other',
            'description' => 'nullable|string|max:1000',
        ]);

        $matchId = $validated['matchId'];
        $match = MatchSession::find($matchId);

        if (!$match) {
            return response()->json(['success' => false, 'error' => 'match_not_found'], 404);
        }

        // Validate that reporter is a member of this match
        if ($match->participant_a_id !== $session->session_uuid && $match->participant_b_id !== $session->session_uuid) {
            return response()->json(['success' => false, 'error' => 'unauthorized_participant'], 403);
        }

        // Derive reported stranger strictly on backend from match relationship
        $reportedSessionUuid = ($match->participant_a_id === $session->session_uuid)
            ? $match->participant_b_id
            : $match->participant_a_id;

        if (!$reportedSessionUuid) {
            return response()->json(['success' => false, 'error' => 'no_peer_in_match'], 400);
        }

        $reportUuid = 'rep_' . Str::random(20);

        $report = Report::create([
            'report_uuid' => $reportUuid,
            'reporter_session_uuid' => $session->session_uuid,
            'reported_session_uuid' => $reportedSessionUuid,
            'match_id' => $matchId,
            'reason' => $validated['reason'],
            'description' => $validated['description'] ?? null,
            'status' => 'pending',
        ]);

        // Audit the report creation (no secrets logged)
        AuditLog::logEvent(
            'report.filed',
            'session',
            $session->session_uuid,
            'session',
            $reportedSessionUuid,
            [
                'report_uuid' => $reportUuid,
                'reason' => $validated['reason'],
                'match_id' => $matchId,
            ]
        );

        return response()->json([
            'success' => true,
            'message' => 'Report submitted successfully. Our safety team will review it.',
            'reportId' => $reportUuid,
        ], 201);
    }
}
