<?php

use Illuminate\Support\Facades\Broadcast;
use App\Services\SignalingRoomService;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| Channel authorization for private WebRTC match signaling.
| Strictly checks:
| 1. Match exists.
| 2. Match is not ended/expired.
| 3. Client presents cryptographically valid participant token.
| 4. Participant belongs to this match.
|
*/

Broadcast::channel('match.{matchId}', function ($user = null, $matchId = null) {
    $token = request()->header('X-Participant-Token') ?? request()->input('participant_token');
    $participantId = request()->header('X-Participant-ID') ?? request()->input('participant_id');

    if (!$token || !$participantId) {
        return false;
    }

    $service = app(SignalingRoomService::class);
    return $service->authorizeChannel((string) $matchId, (string) $participantId, (string) $token);
});

// Private Session channel for matchmaking notifications
Broadcast::channel('session.{sessionUuid}', function ($user = null, $sessionUuid = null) {
    $sessionToken = request()->header('X-Session-Token') ?? request()->input('session_token');
    if (!$sessionToken || !$sessionUuid) {
        return false;
    }

    $service = app(\App\Services\MatchmakingService::class);
    $session = $service->validateSession((string) $sessionUuid, (string) $sessionToken);
    return $session !== null;
});

// Legacy room channel support
Broadcast::channel('room.{roomId}', function ($user = null, $roomId = null) {
    $token = request()->header('X-Participant-Token') ?? request()->input('participant_token');
    $participantId = request()->header('X-Participant-ID') ?? request()->input('participant_id');

    if (!$token || !$participantId) {
        return false;
    }

    $service = app(SignalingRoomService::class);
    return $service->authorizeChannel((string) $roomId, (string) $participantId, (string) $token);
});
