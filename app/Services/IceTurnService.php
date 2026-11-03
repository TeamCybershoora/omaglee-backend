<?php

namespace App\Services;

class IceTurnService
{
    /**
     * Generate secure ICE configuration containing STUN and short-lived TURN credentials.
     */
    public function generateIceConfig(string $sessionUuid): array
    {
        $rawStun = config('webrtc.stun_urls', 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
        $stunUrls = array_filter(array_map('trim', explode(',', $rawStun)));

        $iceServers = [
            [
                'urls' => array_values($stunUrls),
            ],
        ];

        $turnEnabled = (bool) config('webrtc.turn.enabled', false);
        $turnSecret = config('webrtc.turn.secret');
        $turnHost = config('webrtc.turn.host');
        $turnPort = (int) config('webrtc.turn.port', 3478);
        $turnTlsPort = (int) config('webrtc.turn.tls_port', 5349);
        $ttl = (int) config('webrtc.turn.ttl', 600);
        $tlsEnabled = (bool) config('webrtc.turn.tls_enabled', false);

        if ($turnEnabled && !empty($turnSecret) && !empty($turnHost)) {
            // Coturn REST API ephemeral credential generation
            // Username format: timestamp:session_uuid
            $expiryTimestamp = time() + $ttl;
            $username = "{$expiryTimestamp}:{$sessionUuid}";
            $credential = base64_encode(hash_hmac('sha1', $username, $turnSecret, true));

            $turnUrls = [
                "turn:{$turnHost}:{$turnPort}?transport=udp",
                "turn:{$turnHost}:{$turnPort}?transport=tcp",
            ];

            if ($tlsEnabled) {
                $turnUrls[] = "turns:{$turnHost}:{$turnTlsPort}?transport=tcp";
            }

            $iceServers[] = [
                'urls' => $turnUrls,
                'username' => $username,
                'credential' => $credential,
            ];

            return [
                'iceServers' => $iceServers,
                'credentialExpiresAt' => gmdate('Y-m-d\TH:i:s\Z', $expiryTimestamp),
                'turnConfigured' => true,
                'defaultTransportPolicy' => 'all',
                'note' => 'STUN and ephemeral coturn REST API TURN relay credentials active.',
            ];
        }

        return [
            'iceServers' => $iceServers,
            'credentialExpiresAt' => null,
            'turnConfigured' => false,
            'defaultTransportPolicy' => 'all',
            'note' => 'Public STUN servers configured. Direct P2P connectivity active; TURN relay disabled.',
        ];
    }
}
