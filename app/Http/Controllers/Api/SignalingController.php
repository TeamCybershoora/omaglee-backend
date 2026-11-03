<?php

namespace App\Http\Controllers\Api;

use App\Events\MatchCreated;
use App\Events\WebRTCOfferCreated;
use App\Events\WebRTCAnswerCreated;
use App\Events\IceCandidateReceived;
use App\Events\UserDisconnected;
use App\Events\MatchEnded;
use App\Events\SignalingMessageEvent;
use App\Http\Controllers\Controller;
use App\Services\SignalingRoomService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class SignalingController extends Controller
{
    protected SignalingRoomService $roomService;

    public function __construct(SignalingRoomService $roomService)
    {
        $this->roomService = $roomService;
    }

    /**
     * Authorize private channel subscription for Laravel Echo.
     */
    public function authenticate(Request $request): JsonResponse
    {
        $channelName = $request->input('channel_name');
        $socketId = $request->input('socket_id');
        $token = $request->header('X-Participant-Token') ?? $request->input('participant_token');
        $participantId = $request->header('X-Participant-ID') ?? $request->input('participant_id');

        if (!$channelName || !$socketId || !$token || !$participantId) {
            return response()->json(['message' => 'Missing authorization parameters.'], 403);
        }

        // Channel format: private-match.{matchId} or private-room.{roomId}
        $matchId = preg_replace('/^(private-match\.|private-room\.)/', '', $channelName);
        if (!$this->roomService->authorizeChannel($matchId, $participantId, $token)) {
            return response()->json(['message' => 'Unauthorized channel access.'], 403);
        }

        // Generate Pusher/Reverb HMAC signature
        $reverbSecret = env('REVERB_APP_SECRET', 'omaglee-app-secret');
        $stringToSign = "{$socketId}:{$channelName}";
        $signature = hash_hmac('sha256', $stringToSign, $reverbSecret);
        $reverbKey = env('REVERB_APP_KEY', 'omaglee-app-key');

        return response()->json([
            'auth' => "{$reverbKey}:{$signature}",
        ]);
    }

    /**
     * Join an authorized controlled 2-user test match.
     */
    public function joinRoom(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'roomId' => 'nullable|string|max:64',
            'matchId' => 'nullable|string|max:64',
            'participantId' => 'required|string|max:64',
            'displayName' => 'nullable|string|max:64',
        ]);

        $matchId = $validated['matchId'] ?? $validated['roomId'] ?? 'match-test-1';

        $res = $this->roomService->joinMatch(
            $matchId,
            $validated['participantId'],
            $validated['displayName'] ?? null
        );

        if (!$res['success']) {
            $status = $res['error'] === 'match_ended' ? 410 : 403;
            return response()->json($res, $status);
        }

        // When match becomes active with 2 participants, broadcast MatchCreated
        if ($res['is_ready']) {
            try {
                broadcast(new MatchCreated(
                    $matchId,
                    $res['participant_id'],
                    'peer'
                ))->toOthers();
            } catch (Throwable $e) {
                // Non-fatal if Reverb server offline in local test
            }
        }

        return response()->json($res);
    }

    /**
     * Dispatch an SDP offer, answer, or ICE candidate with validation.
     */
    public function postMessage(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'roomId' => 'nullable|string|max:64',
            'matchId' => 'nullable|string|max:64',
            'participantId' => 'required|string|max:64',
            'participantToken' => 'required|string',
            'type' => 'required|string|in:offer,answer,ice.candidate,call.ready,call.end,call.error',
            'messageId' => 'nullable|string|max:64',
            'sequenceNumber' => 'nullable|integer',
            'timestamp' => 'nullable|numeric',
            'payload' => 'required',
        ]);

        $matchId = $validated['matchId'] ?? $validated['roomId'];
        $mId = $validated['messageId'] ?? uniqid('sig_', true);
        $seq = $validated['sequenceNumber'] ?? null;
        $time = $validated['timestamp'] ?? microtime(true);

        $res = $this->roomService->dispatchSignaling(
            $matchId,
            $validated['participantId'],
            $validated['participantToken'],
            $validated['type'],
            $validated['payload'],
            $mId,
            $seq,
            $time
        );

        if (!$res['success']) {
            return response()->json($res, $res['status_code'] ?? 403);
        }

        // Broadcast corresponding discrete event over Reverb
        try {
            switch ($validated['type']) {
                case 'offer':
                    broadcast(new WebRTCOfferCreated(
                        $matchId,
                        $validated['participantId'],
                        $validated['payload'],
                        $mId,
                        $res['sequence'],
                        $time
                    ))->toOthers();
                    break;
                case 'answer':
                    broadcast(new WebRTCAnswerCreated(
                        $matchId,
                        $validated['participantId'],
                        $validated['payload'],
                        $mId,
                        $res['sequence'],
                        $time
                    ))->toOthers();
                    break;
                case 'ice.candidate':
                    broadcast(new IceCandidateReceived(
                        $matchId,
                        $validated['participantId'],
                        $validated['payload'],
                        $mId,
                        $res['sequence'],
                        $time
                    ))->toOthers();
                    break;
                case 'call.end':
                    broadcast(new UserDisconnected(
                        $matchId,
                        $validated['participantId'],
                        'user_ended',
                        $time
                    ))->toOthers();
                    broadcast(new MatchEnded(
                        $matchId,
                        'user_ended',
                        $time
                    ))->toOthers();
                    break;
                default:
                    broadcast(new SignalingMessageEvent(
                        $matchId,
                        $validated['participantId'],
                        null,
                        $validated['type'],
                        $validated['payload'],
                        $time
                    ))->toOthers();
                    break;
            }
        } catch (Throwable $e) {
            // Broadcaster offline
        }

        return response()->json($res);
    }

    /**
     * Poll pending messages (synchronized fallback transport).
     */
    public function pollMessages(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'roomId' => 'nullable|string|max:64',
            'matchId' => 'nullable|string|max:64',
            'participantId' => 'required|string|max:64',
            'participantToken' => 'required|string',
            'since' => 'nullable|numeric',
        ]);

        $matchId = $validated['matchId'] ?? $validated['roomId'];

        $res = $this->roomService->getPendingMessages(
            $matchId,
            $validated['participantId'],
            $validated['participantToken'],
            (float) ($validated['since'] ?? 0)
        );

        if (!$res['success']) {
            return response()->json($res, $res['status_code'] ?? 403);
        }

        return response()->json($res);
    }

    /**
     * Leave match and terminate session.
     */
    public function leaveRoom(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'roomId' => 'nullable|string|max:64',
            'matchId' => 'nullable|string|max:64',
            'participantId' => 'required|string|max:64',
            'participantToken' => 'required|string',
        ]);

        $matchId = $validated['matchId'] ?? $validated['roomId'];

        $res = $this->roomService->endMatch(
            $matchId,
            $validated['participantId'],
            $validated['participantToken']
        );

        try {
            broadcast(new UserDisconnected($matchId, $validated['participantId'], 'user_left'))->toOthers();
            broadcast(new MatchEnded($matchId, 'user_left'))->toOthers();
        } catch (Throwable $e) {
            //
        }

        return response()->json($res);
    }

    /**
     * Get safe ICE server configuration.
     */
    public function getIceServers(): JsonResponse
    {
        $iceEnv = env('ICE_SERVERS', 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
        $urls = array_filter(array_map('trim', explode(',', $iceEnv)));

        return response()->json([
            'iceServers' => [
                ['urls' => array_values($urls)],
            ],
            'turnConfigured' => false,
            'note' => 'Google STUN servers configured for Phase 4 peer signaling testing.',
        ]);
    }
}
