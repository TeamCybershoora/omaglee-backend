<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class DashboardStatusController extends Controller
{
    /**
     * Return high-level administrative status information.
     */
    public function overview(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'portal' => 'Omaglee Admin Management',
            'phase' => 'Phase 1 Foundation',
            'metrics' => [
                'active_sessions' => 0,
                'pending_reports' => 0,
                'banned_users' => 0,
                'moderation_state' => 'standby',
            ],
            'note' => 'Full administrative metrics and moderation handlers activate in subsequent phases.',
            'timestamp' => now()->toIso8601String(),
        ]);
    }
}
