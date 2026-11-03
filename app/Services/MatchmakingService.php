<?php

namespace App\Services;

use App\Events\MatchCreated;
use App\Events\MatchEnded;
use App\Events\MatchFound;
use App\Events\UserDisconnected;
use App\Models\AnonymousSession;
use App\Models\MatchmakingQueue;
use App\Models\MatchSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MatchmakingService
{
    protected string $secretKey;

    public function __construct()
    {
        $this->secretKey = config('app.key', 'omaglee-signaling-secret-key-32ch');
    }

    /**
     * Create an anonymous session with a cryptographically secure token.
     */
    public function createSession(?string $ip = null, ?string $userAgent = null): array
    {
        return AnonymousSession::createSecureSession($ip, $userAgent);
    }

    /**
     * Validate an anonymous session from UUID and raw token.
     */
    public function validateSession(?string $sessionUuid, ?string $rawToken): ?AnonymousSession
    {
        if (!$sessionUuid || !$rawToken) {
            return null;
        }

        $session = AnonymousSession::where('session_uuid', $sessionUuid)->first();
        if (!$session || $session->isExpired()) {
            return null;
        }

        if (!$session->verifyToken($rawToken)) {
            return null;
        }

        $session->touchActivity();
        return $session;
    }

    /**
     * Generate an HMAC token for WebRTC signaling authorization.
     */
    public function generateParticipantToken(string $matchId, string $participantId): string
    {
        return hash_hmac('sha256', "{$matchId}:{$participantId}", $this->secretKey);
    }

    /**
     * Enter waiting queue and atomically find an eligible stranger.
     */
    public function joinQueue(AnonymousSession $session): array
    {
        // 1. Strict Invariant: One active match per session at any time
        if ($session->active_match_id) {
            $existingMatch = MatchSession::find($session->active_match_id);
            if ($existingMatch && !$existingMatch->isEnded()) {
                return [
                    'success' => false,
                    'error' => 'already_in_match',
                    'message' => 'You already have an active match in progress.',
                    'matchId' => $existingMatch->id,
                ];
            }
            // Clear stale active match pointer
            $session->update(['active_match_id' => null]);
        }

        // 2. Perform atomic matchmaking inside a database transaction
        return DB::transaction(function () use ($session) {
            $now = now();
            $heartbeatCutoff = $now->copy()->subSeconds(30);

            // Clean up stale or cancelled queue entries for this session
            MatchmakingQueue::where('session_uuid', $session->session_uuid)
                ->whereIn('status', ['waiting', 'reserved', 'cancelled', 'expired'])
                ->delete();

            // Search for an eligible waiting stranger with row-level locking
            $strangerQueue = MatchmakingQueue::where('status', 'waiting')
                ->where('session_uuid', '!=', $session->session_uuid)
                ->where('last_heartbeat_at', '>=', $heartbeatCutoff)
                ->where('expires_at', '>', $now)
                ->orderBy('joined_at', 'asc')
                ->lockForUpdate()
                ->first();

            if ($strangerQueue) {
                // Fetch stranger session and verify it is not in an active match
                $strangerSession = AnonymousSession::where('session_uuid', $strangerQueue->session_uuid)
                    ->lockForUpdate()
                    ->first();

                if ($strangerSession && !$strangerSession->isExpired() && !$strangerSession->active_match_id) {
                    // ATOMIC RESERVATION
                    $matchId = 'match_' . Str::random(24);
                    $initiatorId = $session->session_uuid;
                    $receiverId = $strangerSession->session_uuid;

                    $tokenA = $this->generateParticipantToken($matchId, $initiatorId);
                    $tokenB = $this->generateParticipantToken($matchId, $receiverId);

                    // Create MatchSession
                    $match = MatchSession::create([
                        'id' => $matchId,
                        'status' => 'pending',
                        'started_at' => $now,
                        'participant_a_id' => $initiatorId,
                        'participant_b_id' => $receiverId,
                        'participant_a_token' => $tokenA,
                        'participant_b_token' => $tokenB,
                        'message_sequence' => 0,
                        'metadata' => [
                            'created_via' => 'matchmaking_engine_v1',
                        ],
                    ]);

                    // Update stranger queue entry
                    $strangerQueue->update([
                        'status' => 'matched',
                        'match_id' => $matchId,
                        'reserved_at' => $now,
                    ]);

                    // Update sessions
                    $session->update([
                        'status' => 'matched',
                        'active_match_id' => $matchId,
                    ]);
                    $strangerSession->update([
                        'status' => 'matched',
                        'active_match_id' => $matchId,
                    ]);

                    // Broadcast real-time match notification to stranger via Reverb
                    broadcast(new MatchFound(
                        $strangerSession->session_uuid,
                        $matchId,
                        'receiver',
                        $receiverId,
                        $tokenB
                    ));

                    broadcast(new MatchCreated(
                        $matchId,
                        $initiatorId,
                        $receiverId
                    ));

                    return [
                        'success' => true,
                        'status' => 'matched',
                        'matchId' => $matchId,
                        'role' => 'initiator',
                        'participantId' => $initiatorId,
                        'participantToken' => $tokenA,
                        'channel' => "private-match.{$matchId}",
                        'message' => 'Stranger found and paired successfully!',
                    ];
                }
            }

            // No stranger currently available -> insert into waiting queue
            MatchmakingQueue::create([
                'session_uuid' => $session->session_uuid,
                'status' => 'waiting',
                'joined_at' => $now,
                'last_heartbeat_at' => $now,
                'expires_at' => $now->copy()->addSeconds(60),
            ]);

            $session->update(['status' => 'waiting']);

            return [
                'success' => true,
                'status' => 'waiting',
                'sessionUuid' => $session->session_uuid,
                'message' => 'Waiting in matchmaking queue for an available stranger.',
                'pollIntervalMs' => 1500,
            ];
        });
    }

    /**
     * Check matchmaking status (polled by waiting peer or fallback).
     */
    public function checkStatus(AnonymousSession $session): array
    {
        $queueEntry = MatchmakingQueue::where('session_uuid', $session->session_uuid)
            ->latest('id')
            ->first();

        if (!$queueEntry) {
            return [
                'status' => 'idle',
                'message' => 'No active matchmaking queue entry found.',
            ];
        }

        // Update heartbeat
        $queueEntry->update(['last_heartbeat_at' => now()]);

        if ($queueEntry->status === 'matched' && $queueEntry->match_id) {
            $match = MatchSession::find($queueEntry->match_id);
            if ($match && !$match->isEnded()) {
                $role = $match->getRole($session->session_uuid);
                $token = ($role === 'initiator') ? $match->participant_a_token : $match->participant_b_token;

                return [
                    'status' => 'matched',
                    'matchId' => $match->id,
                    'role' => $role,
                    'participantId' => $session->session_uuid,
                    'participantToken' => $token,
                    'channel' => "private-match.{$match->id}",
                ];
            }
        }

        if ($queueEntry->isExpired()) {
            $queueEntry->update(['status' => 'expired']);
            $session->update(['status' => 'idle']);
            return [
                'status' => 'expired',
                'message' => 'Queue wait timed out. Please click Start to search again.',
            ];
        }

        return [
            'status' => $queueEntry->status,
            'joinedAt' => $queueEntry->joined_at,
            'waitingSeconds' => now()->diffInSeconds($queueEntry->joined_at),
        ];
    }

    /**
     * Cancel waiting in queue.
     */
    public function cancelQueue(AnonymousSession $session): array
    {
        MatchmakingQueue::where('session_uuid', $session->session_uuid)
            ->whereIn('status', ['waiting', 'reserved'])
            ->update(['status' => 'cancelled']);

        $session->update(['status' => 'idle']);

        return [
            'success' => true,
            'message' => 'Matchmaking search cancelled.',
        ];
    }

    /**
     * Handle 'Next' (skip) action:
     * 1. End old match with reason 'next'.
     * 2. Invalidate for both participants and broadcast MatchEnded.
     * 3. Clear old reservations.
     * 4. Place requester into a new queue entry immediately.
     */
    public function nextMatch(AnonymousSession $session, string $matchId): array
    {
        return DB::transaction(function () use ($session, $matchId) {
            $match = MatchSession::where('id', $matchId)->lockForUpdate()->first();

            if ($match && !$match->isEnded() && $match->hasParticipant($session->session_uuid)) {
                // End previous match
                $match->endMatch('next');

                // Notify both participants via discrete Reverb event
                broadcast(new MatchEnded($matchId, 'next'));

                // Clear active match pointers
                AnonymousSession::whereIn('session_uuid', [$match->participant_a_id, $match->participant_b_id])
                    ->update(['active_match_id' => null, 'status' => 'idle']);
            }

            // Immediately put the requester into queue
            return $this->joinQueue($session);
        });
    }

    /**
     * Graceful disconnect or end call.
     */
    public function disconnectMatch(AnonymousSession $session, string $matchId, string $reason = 'disconnect'): array
    {
        return DB::transaction(function () use ($session, $matchId, $reason) {
            $match = MatchSession::where('id', $matchId)->lockForUpdate()->first();

            if ($match && !$match->isEnded() && $match->hasParticipant($session->session_uuid)) {
                $match->endMatch($reason);

                broadcast(new UserDisconnected($matchId, $session->session_uuid, $reason));
                broadcast(new MatchEnded($matchId, $reason));

                AnonymousSession::whereIn('session_uuid', [$match->participant_a_id, $match->participant_b_id])
                    ->update(['active_match_id' => null, 'status' => 'idle']);
            }

            $session->update(['status' => 'idle', 'active_match_id' => null]);

            return [
                'success' => true,
                'message' => 'Call disconnected successfully.',
            ];
        });
    }

    /**
     * Periodic cleanup for stale queue entries.
     */
    public function cleanupStaleEntries(): int
    {
        $cutoff = now()->subSeconds(35);
        return MatchmakingQueue::where('status', 'waiting')
            ->where(function ($q) use ($cutoff) {
                $q->where('last_heartbeat_at', '<', $cutoff)
                  ->orWhere('expires_at', '<', now());
            })
            ->update(['status' => 'expired']);
    }
}
