<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\HealthCheckController;
use App\Http\Controllers\Api\SignalingController;
use App\Http\Controllers\Api\MatchmakingController;
use App\Http\Controllers\Api\MatchLifecycleController;
use App\Http\Controllers\Api\IceConfigController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\BlockController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Admin\DashboardStatusController;
use App\Http\Controllers\Admin\AdminModerationController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Centralized REST API endpoints for Omaglee Web and Admin frontends.
| All responses are JSON formatted.
|
*/

// Public Health Check Endpoints (Phase 11 Subsystem Diagnostics)
Route::get('/health', [HealthCheckController::class, 'index'])->name('api.health');
Route::get('/health/database', [HealthCheckController::class, 'database'])->name('api.health.database');
Route::get('/health/reverb', [HealthCheckController::class, 'reverb'])->name('api.health.reverb');
Route::get('/health/redis', [HealthCheckController::class, 'redis'])->name('api.health.redis');
Route::get('/health/turn', [HealthCheckController::class, 'turn'])->name('api.health.turn');

// Phase 1 System Status Endpoint
Route::get('/status', [HealthCheckController::class, 'status'])->name('api.status');

// Laravel Echo Channel Authentication Endpoint (Phase 4)
Route::post('/broadcasting/auth', [SignalingController::class, 'authenticate'])->name('api.broadcasting.auth');

// WebRTC Signaling & Match Authorization Endpoints (Phase 4)
Route::prefix('signaling')->group(function () {
    Route::post('/room/join', [SignalingController::class, 'joinRoom'])->name('api.signaling.join');
    Route::post('/match/join', [SignalingController::class, 'joinRoom'])->name('api.signaling.match.join');
    Route::post('/message', [SignalingController::class, 'postMessage'])->name('api.signaling.message');
    Route::get('/messages/poll', [SignalingController::class, 'pollMessages'])->name('api.signaling.poll');
    Route::post('/room/leave', [SignalingController::class, 'leaveRoom'])->name('api.signaling.leave');
    Route::post('/match/leave', [SignalingController::class, 'leaveRoom'])->name('api.signaling.match.leave');
    Route::get('/ice-servers', [SignalingController::class, 'getIceServers'])->name('api.signaling.ice');
});

// Phase 5 Random Matchmaking Engine Endpoints
Route::prefix('matchmaking')->group(function () {
    Route::post('/session', [MatchmakingController::class, 'createSession'])->name('api.matchmaking.session');
    Route::post('/start', [MatchmakingController::class, 'start'])->name('api.matchmaking.start');
    Route::get('/status', [MatchmakingController::class, 'status'])->name('api.matchmaking.status');
    Route::post('/cancel', [MatchmakingController::class, 'cancel'])->name('api.matchmaking.cancel');
});

// Phase 5 Match Lifecycle Endpoints
Route::prefix('matches/{matchId}')->group(function () {
    Route::post('/next', [MatchLifecycleController::class, 'next'])->name('api.matches.next');
    Route::post('/disconnect', [MatchLifecycleController::class, 'disconnect'])->name('api.matches.disconnect');
    Route::post('/heartbeat', [MatchLifecycleController::class, 'heartbeat'])->name('api.matches.heartbeat');
    Route::get('/status', [MatchLifecycleController::class, 'status'])->name('api.matches.status');
});

// Phase 6 WebRTC ICE & TURN Relay Endpoints
Route::prefix('webrtc')->group(function () {
    Route::get('/ice-config', [IceConfigController::class, 'getIceConfig'])->name('api.webrtc.ice-config');
    Route::post('/diagnostics', [IceConfigController::class, 'recordDiagnostics'])->name('api.webrtc.diagnostics');
});

// Phase 8 & 9 Safety, Blocks, Reports & Moderation Endpoints
Route::post('/reports', [ReportController::class, 'store'])->name('api.reports.store');
Route::post('/blocks', [BlockController::class, 'store'])->name('api.blocks.store');
Route::get('/system/stats', [SystemController::class, 'stats'])->name('api.system.stats');
Route::post('/cleanup/run', [SystemController::class, 'runCleanup'])->name('api.cleanup.run');

// Admin Moderation & Dashboard API Endpoints (Phase 9 & 10)
Route::prefix('admin')->group(function () {
    Route::post('/auth/login', [AdminModerationController::class, 'login'])->name('api.admin.auth.login');
    Route::get('/overview', [DashboardStatusController::class, 'overview'])->name('api.admin.overview');
    Route::get('/moderation/overview', [AdminModerationController::class, 'overview'])->name('api.admin.moderation.overview');
    Route::get('/users', [AdminModerationController::class, 'getUsers'])->name('api.admin.users');
    Route::post('/users/{sessionUuid}/restrict', [AdminModerationController::class, 'restrictUser'])->name('api.admin.users.restrict');
    Route::get('/reports', [AdminModerationController::class, 'getReports'])->name('api.admin.reports');
    Route::patch('/reports/{id}', [AdminModerationController::class, 'updateReport'])->name('api.admin.reports.update');
    Route::get('/bans', [AdminModerationController::class, 'getBans'])->name('api.admin.bans');
    Route::post('/bans', [AdminModerationController::class, 'createBan'])->name('api.admin.bans.create');
    Route::delete('/bans/{id}', [AdminModerationController::class, 'revokeBan'])->name('api.admin.bans.revoke');
    Route::get('/matches', [AdminModerationController::class, 'getMatches'])->name('api.admin.matches');
    Route::get('/system-health', [AdminModerationController::class, 'getSystemHealth'])->name('api.admin.system-health');
    Route::get('/settings', [AdminModerationController::class, 'getSettings'])->name('api.admin.settings');
    Route::patch('/settings', [AdminModerationController::class, 'updateSettings'])->name('api.admin.settings.update');
    Route::get('/abuse-monitoring', [AdminModerationController::class, 'getAbuseMonitoring'])->name('api.admin.abuse-monitoring');
    Route::get('/audit-logs', [AdminModerationController::class, 'getAuditLogs'])->name('api.admin.audit-logs');
});
