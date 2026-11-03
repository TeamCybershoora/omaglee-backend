<?php

namespace App\Services;

class SignalingRoomService
{
    private static string $storagePath;
    private const MAX_MESSAGE_SIZE = 15360; // 15 KB limit to prevent payload flooding
    private const RATE_LIMIT_MAX = 60;      // 60 messages per window
    private const RATE_LIMIT_WINDOW = 60;   // 60 seconds window
    private const FRESHNESS_WINDOW = 30;    // max 30s drift

    public function __construct()
    {
        self::$storagePath = storage_path('framework/cache/match_sessions.json');
    }

    /**
     * Load matches state from cache file.
     */
    private function loadMatches(): array
    {
        $file = storage_path('framework/cache/match_sessions.json');
        if (file_exists($file)) {
            $data = json_decode(file_get_contents($file), true);
            if (is_array($data)) {
                return $data;
            }
        }
        return [];
    }

    /**
     * Persist matches state.
     */
    private function saveMatches(array $matches): void
    {
        $dir = storage_path('framework/cache');
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        file_put_contents(storage_path('framework/cache/match_sessions.json'), json_encode($matches, JSON_PRETTY_PRINT));
    }

    /**
     * Cryptographic HMAC token for guest participant in match.
     */
    public function generateToken(string $matchId, string $participantId): string
    {
        $secret = config('app.key') ?: 'omaglee-signaling-secret-key-32ch';
        return hash_hmac('sha256', "{$matchId}:{$participantId}", $secret);
    }

    /**
     * Verify token.
     */
    public function verifyToken(string $matchId, string $participantId, string $token): bool
    {
        return hash_equals($this->generateToken($matchId, $participantId), $token);
    }

    /**
     * Server-side channel authorization check.
     */
    public function authorizeChannel(string $matchId, string $participantId, string $token): bool
    {
        if (!$this->verifyToken($matchId, $participantId, $token)) {
            return false;
        }

        $matches = $this->loadMatches();
        if (!isset($matches[$matchId])) {
            return false;
        }

        $match = $matches[$matchId];
        if (in_array($match['status'], ['ended', 'expired'], true)) {
            return false;
        }

        return isset($match['participants'][$participantId]);
    }

    /**
     * Join or create an authorized 2-user match.
     */
    public function joinMatch(string $matchId, string $participantId, ?string $displayName = null): array
    {
        $matches = $this->loadMatches();
        $now = time();

        // Expire older sessions (> 2h)
        foreach ($matches as $mId => $data) {
            if (($now - ($data['updated_at'] ?? 0)) > 7200) {
                unset($matches[$mId]);
            }
        }

        if (!isset($matches[$matchId])) {
            $matches[$matchId] = [
                'match_id' => $matchId,
                'status' => 'pending',
                'created_at' => $now,
                'updated_at' => $now,
                'ended_at' => null,
                'sequence' => 0,
                'processed_message_ids' => [],
                'rate_limits' => [],
                'participants' => [],
                'messages' => [],
            ];
        }

        $match = &$matches[$matchId];

        if ($match['status'] === 'ended' || $match['status'] === 'expired') {
            return [
                'success' => false,
                'error' => 'match_ended',
                'message' => 'This match session has already ended or expired.',
            ];
        }

        $participants = &$match['participants'];

        // If already in match, update heartbeat
        if (isset($participants[$participantId])) {
            $participants[$participantId]['updated_at'] = $now;
            $match['updated_at'] = $now;
            $this->saveMatches($matches);

            return [
                'success' => true,
                'match_id' => $matchId,
                'participant_id' => $participantId,
                'participant_token' => $this->generateToken($matchId, $participantId),
                'role' => $participants[$participantId]['role'],
                'peer_count' => count($participants),
                'status' => $match['status'],
                'is_ready' => count($participants) === 2,
            ];
        }

        // Limit strictly to 2 participants
        if (count($participants) >= 2) {
            return [
                'success' => false,
                'error' => 'match_full',
                'message' => 'This match session already has two authorized participants.',
            ];
        }

        $role = (count($participants) === 0) ? 'initiator' : 'receiver';
        $participants[$participantId] = [
            'id' => $participantId,
            'name' => $displayName ?: ('User ' . (count($participants) + 1)),
            'role' => $role,
            'joined_at' => $now,
            'updated_at' => $now,
        ];

        if (count($participants) === 2) {
            $match['status'] = 'active';
        }

        $match['updated_at'] = $now;
        $this->saveMatches($matches);

        return [
            'success' => true,
            'match_id' => $matchId,
            'participant_id' => $participantId,
            'participant_token' => $this->generateToken($matchId, $participantId),
            'role' => $role,
            'peer_count' => count($participants),
            'status' => $match['status'],
            'is_ready' => count($participants) === 2,
        ];
    }

    /**
     * Dispatch signaling message with strict validation, rate limiting, and size checks.
     */
    public function dispatchSignaling(
        string $matchId,
        string $senderId,
        string $token,
        string $type,
        $payload,
        ?string $messageId = null,
        ?int $sequenceNumber = null,
        ?float $timestamp = null
    ): array {
        // 1. Authorization
        if (!$this->verifyToken($matchId, $senderId, $token)) {
            return ['success' => false, 'error' => 'unauthorized', 'status_code' => 403, 'message' => 'Invalid participant authorization token.'];
        }

        $matches = $this->loadMatches();
        if (!isset($matches[$matchId])) {
            return ['success' => false, 'error' => 'match_not_found', 'status_code' => 404, 'message' => 'Match not found.'];
        }

        $match = &$matches[$matchId];

        // 2. Status verification
        if ($match['status'] === 'ended' || $match['status'] === 'expired') {
            return ['success' => false, 'error' => 'match_ended', 'status_code' => 410, 'message' => 'Cannot exchange signals for an ended match session.'];
        }

        // 3. Participant membership
        if (!isset($match['participants'][$senderId])) {
            return ['success' => false, 'error' => 'not_participant', 'status_code' => 403, 'message' => 'Sender does not belong to this match session.'];
        }

        // 4. Payload size check
        $payloadString = json_encode($payload);
        if (strlen($payloadString) > self::MAX_MESSAGE_SIZE) {
            return ['success' => false, 'error' => 'payload_too_large', 'status_code' => 413, 'message' => 'Signaling payload exceeds maximum size limit (15KB).'];
        }

        // 5. Rate limiting (sliding window per participant)
        $now = time();
        if (!isset($match['rate_limits'][$senderId])) {
            $match['rate_limits'][$senderId] = [];
        }
        $match['rate_limits'][$senderId] = array_filter(
            $match['rate_limits'][$senderId],
            fn ($t) => ($now - $t) < self::RATE_LIMIT_WINDOW
        );

        if (count($match['rate_limits'][$senderId]) >= self::RATE_LIMIT_MAX) {
            return ['success' => false, 'error' => 'rate_limited', 'status_code' => 429, 'message' => 'Too many signaling messages. Rate limit exceeded.'];
        }
        $match['rate_limits'][$senderId][] = $now;

        // 6. Duplicate message ID detection
        $mId = $messageId ?: uniqid('sig_', true);
        if (isset($match['processed_message_ids'][$mId])) {
            return ['success' => false, 'error' => 'duplicate_message', 'status_code' => 409, 'message' => 'Duplicate message ID rejected.'];
        }
        $match['processed_message_ids'][$mId] = $now;
        if (count($match['processed_message_ids']) > 200) {
            array_shift($match['processed_message_ids']);
        }

        // 7. Monotonic sequence counter
        $match['sequence']++;
        $assignedSeq = $sequenceNumber ?? $match['sequence'];

        $msgRecord = [
            'id' => $mId,
            'match_id' => $matchId,
            'sender_id' => $senderId,
            'type' => $type,
            'payload' => $payload,
            'sequence' => $assignedSeq,
            'timestamp' => $timestamp ?? microtime(true),
        ];

        $match['messages'][] = $msgRecord;
        if (count($match['messages']) > 100) {
            array_shift($match['messages']);
        }
        $match['updated_at'] = $now;
        $this->saveMatches($matches);

        return [
            'success' => true,
            'message_id' => $mId,
            'sequence' => $assignedSeq,
            'message' => $msgRecord,
        ];
    }

    /**
     * Poll pending messages for fallback transport.
     */
    public function getPendingMessages(string $matchId, string $participantId, string $token, float $since = 0): array
    {
        if (!$this->verifyToken($matchId, $participantId, $token)) {
            return ['success' => false, 'error' => 'unauthorized', 'status_code' => 403];
        }

        $matches = $this->loadMatches();
        if (!isset($matches[$matchId])) {
            return ['success' => true, 'messages' => [], 'status' => 'not_found'];
        }

        $match = $matches[$matchId];
        $messages = [];
        foreach ($match['messages'] ?? [] as $m) {
            if ($m['timestamp'] > $since && $m['sender_id'] !== $participantId) {
                $messages[] = $m;
            }
        }

        return [
            'success' => true,
            'match_id' => $matchId,
            'status' => $match['status'],
            'messages' => $messages,
            'server_time' => microtime(true),
        ];
    }

    /**
     * Terminate match or handle participant disconnect.
     */
    public function endMatch(string $matchId, string $participantId, string $token, string $reason = 'user_ended'): array
    {
        if (!$this->verifyToken($matchId, $participantId, $token)) {
            return ['success' => false, 'error' => 'unauthorized', 'status_code' => 403];
        }

        $matches = $this->loadMatches();
        if (isset($matches[$matchId])) {
            $matches[$matchId]['status'] = 'ended';
            $matches[$matchId]['ended_at'] = time();
            $matches[$matchId]['updated_at'] = time();
            $this->saveMatches($matches);
        }

        return ['success' => true];
    }
}
