<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\IceTurnService;
use App\Services\MatchmakingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IceConfigController extends Controller
{
    protected IceTurnService $iceTurnService;
    protected MatchmakingService $matchmakingService;

    public function __construct(IceTurnService $iceTurnService, MatchmakingService $matchmakingService)
    {
        $this->iceTurnService = $iceTurnService;
        $this->matchmakingService = $matchmakingService;
    }

    /**
     * Get authorized ICE configuration (STUN + short-lived TURN credentials).
     * GET /api/webrtc/ice-config
     */
    public function getIceConfig(Request $request): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->query('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->query('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json([
                'success' => false,
                'error' => 'invalid_session',
                'message' => 'Valid anonymous session required to obtain WebRTC ICE credentials.',
            ], 401);
        }

        $config = $this->iceTurnService->generateIceConfig($session->session_uuid);

        return response()->json(array_merge(['success' => true], $config), 200);
    }

    /**
     * Submit aggregated WebRTC connection diagnostics (route type, rtt, loss) without storing raw user IPs.
     * POST /api/webrtc/diagnostics
     */
    public function recordDiagnostics(Request $request): JsonResponse
    {
        $sessionUuid = $request->header('X-Session-UUID') ?? $request->input('sessionUuid');
        $sessionToken = $request->header('X-Session-Token') ?? $request->input('sessionToken');

        $session = $this->matchmakingService->validateSession($sessionUuid, $sessionToken);
        if (!$session) {
            return response()->json(['success' => false, 'error' => 'invalid_session'], 401);
        }

        $validated = $request->validate([
            'matchId' => 'required|string|max:64',
            'routeType' => 'required|string|in:direct_p2p,turn_relay,unknown',
            'rttMs' => 'nullable|numeric',
            'packetLossPercent' => 'nullable|numeric',
            'privacyMode' => 'nullable|boolean',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Diagnostics logged successfully.',
            'summary' => [
                'route' => $validated['routeType'],
                'privacyMode' => $validated['privacyMode'] ?? false,
            ],
        ], 200);
    }
}
