<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
if (file_exists(__DIR__.'/../vendor/autoload.php')) {
    require __DIR__.'/../vendor/autoload.php';
    
    // Bootstrap Laravel and handle the request...
    (require_once __DIR__.'/../bootstrap/app.php')
        ->handleRequest(Request::capture());
    exit;
}

// Fallback standalone health & signaling responses if vendor has not yet been populated via composer install
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if (str_starts_with($uri, '/api/')) {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Participant-Token, X-Participant-ID');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    if (str_starts_with($uri, '/api/health')) {
        echo json_encode([
            'status' => 'ok',
            'application' => 'Omaglee Centralized Backend',
            'environment' => 'Phase 3 WebRTC & Reverb Ready',
            'api_version' => '1.0.0',
            'services' => [
                'api' => 'online',
                'signaling' => 'active',
                'database' => [
                    'configured' => !empty(getenv('DB_DATABASE')),
                    'host' => getenv('DB_HOST') ?: 'serverbyt_pending',
                ],
            ],
            'timestamp' => gmdate('Y-m-d\TH:i:s\Z')
        ], JSON_PRETTY_PRINT);
        exit;
    }

    if ($uri === '/api/signaling/ice-servers') {
        echo json_encode([
            'iceServers' => [
                ['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']]
            ],
            'turnConfigured' => false,
            'note' => 'Google STUN servers configured for Phase 3 peer testing.'
        ]);
        exit;
    }

    $storageDir = __DIR__ . '/../storage/framework/cache';
    if (!is_dir($storageDir)) {
        @mkdir($storageDir, 0755, true);
    }
    $roomsFile = $storageDir . '/rooms.json';

    $loadRooms = function () use ($roomsFile) {
        if (file_exists($roomsFile)) {
            $data = json_decode(file_get_contents($roomsFile), true);
            if (is_array($data)) return $data;
        }
        return [];
    };

    $saveRooms = function ($rooms) use ($roomsFile) {
        file_put_contents($roomsFile, json_encode($rooms, JSON_PRETTY_PRINT));
    };

    $genToken = function ($roomId, $pId) {
        return hash_hmac('sha256', "{$roomId}:{$pId}", 'omaglee-signaling-secret-key-32ch');
    };

    $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;

    if ($uri === '/api/signaling/room/join' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $roomId = $input['roomId'] ?? 'test-room';
        $pId = $input['participantId'] ?? uniqid('peer_');
        $name = $input['displayName'] ?? 'User';

        $rooms = $loadRooms();
        if (!isset($rooms[$roomId])) {
            $rooms[$roomId] = ['room_id' => $roomId, 'participants' => [], 'messages' => [], 'updated_at' => time()];
        }

        $participants = &$rooms[$roomId]['participants'];
        if (!isset($participants[$pId]) && count($participants) >= 2) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'room_full', 'message' => 'Room already has two active participants.']);
            exit;
        }

        $role = (!isset($participants[$pId]) && count($participants) === 0) ? 'initiator' : 'receiver';
        $participants[$pId] = [
            'id' => $pId,
            'name' => $name,
            'role' => $role,
            'joined_at' => time(),
            'updated_at' => time(),
        ];
        $rooms[$roomId]['updated_at'] = time();
        $saveRooms($rooms);

        echo json_encode([
            'success' => true,
            'room_id' => $roomId,
            'participant_id' => $pId,
            'participant_token' => $genToken($roomId, $pId),
            'role' => $role,
            'peer_count' => count($participants),
            'peers' => array_values($participants),
            'is_ready' => count($participants) === 2,
        ]);
        exit;
    }

    if ($uri === '/api/signaling/message' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $roomId = $input['roomId'] ?? '';
        $pId = $input['participantId'] ?? '';
        $token = $input['participantToken'] ?? '';
        $type = $input['type'] ?? '';
        $targetId = $input['targetId'] ?? null;
        $payload = $input['payload'] ?? null;

        if ($token !== $genToken($roomId, $pId)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'unauthorized']);
            exit;
        }

        $rooms = $loadRooms();
        $msg = [
            'id' => uniqid('sig_', true),
            'room_id' => $roomId,
            'sender_id' => $pId,
            'target_id' => $targetId,
            'type' => $type,
            'payload' => $payload,
            'timestamp' => microtime(true),
        ];

        $rooms[$roomId]['messages'][] = $msg;
        if (count($rooms[$roomId]['messages']) > 100) array_shift($rooms[$roomId]['messages']);
        $rooms[$roomId]['updated_at'] = time();
        $saveRooms($rooms);

        echo json_encode(['success' => true, 'message' => $msg]);
        exit;
    }

    if ($uri === '/api/signaling/messages/poll') {
        $roomId = $_GET['roomId'] ?? $input['roomId'] ?? '';
        $pId = $_GET['participantId'] ?? $input['participantId'] ?? '';
        $token = $_GET['participantToken'] ?? $input['participantToken'] ?? '';
        $since = (float) ($_GET['since'] ?? $input['since'] ?? 0);

        if ($token !== $genToken($roomId, $pId)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'unauthorized']);
            exit;
        }

        $rooms = $loadRooms();
        $msgs = [];
        foreach ($rooms[$roomId]['messages'] ?? [] as $m) {
            if ($m['timestamp'] > $since && $m['sender_id'] !== $pId) {
                if (empty($m['target_id']) || $m['target_id'] === $pId) {
                    $msgs[] = $m;
                }
            }
        }

        echo json_encode(['success' => true, 'messages' => $msgs, 'server_time' => microtime(true)]);
        exit;
    }

    if ($uri === '/api/signaling/room/leave' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $roomId = $input['roomId'] ?? '';
        $pId = $input['participantId'] ?? '';
        $rooms = $loadRooms();
        if (isset($rooms[$roomId]['participants'][$pId])) {
            unset($rooms[$roomId]['participants'][$pId]);
            $rooms[$roomId]['messages'][] = [
                'id' => uniqid('sig_', true),
                'room_id' => $roomId,
                'sender_id' => $pId,
                'target_id' => null,
                'type' => 'call.end',
                'payload' => ['reason' => 'user_left'],
                'timestamp' => microtime(true),
            ];
            $saveRooms($rooms);
        }
        echo json_encode(['success' => true]);
        exit;
    }
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Omaglee Backend — Phase 1</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
        .card { max-width: 640px; margin: 4rem auto; background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; }
        h1 { color: #60a5fa; margin-top: 0; }
        code { background: #090d16; color: #93c5fd; padding: 0.2rem 0.4rem; border-radius: 4px; }
        .status-badge { display: inline-block; background: #065f46; color: #34d399; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <span class="status-badge">Phase 1 Foundation Online</span>
        <h1>Omaglee Centralized Backend</h1>
        <p>This is the centralized Laravel backend for the Omaglee random video-chat platform.</p>
        <p>API Health Endpoint: <code><a href="/api/health" style="color: #93c5fd;">/api/health</a></code></p>
        <p>ServerByt Database: Configured via <code>backend/.env</code></p>
    </div>
</body>
</html>
