<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MatchFound implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $sessionUuid;
    public string $matchId;
    public string $role;
    public string $participantId;
    public string $participantToken;

    public function __construct(
        string $sessionUuid,
        string $matchId,
        string $role,
        string $participantId,
        string $participantToken
    ) {
        $this->sessionUuid = $sessionUuid;
        $this->matchId = $matchId;
        $this->role = $role;
        $this->participantId = $participantId;
        $this->participantToken = $participantToken;
    }

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("session.{$this->sessionUuid}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'match.found';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'role' => $this->role,
            'participantId' => $this->participantId,
            'participantToken' => $this->participantToken,
            'channel' => "private-match.{$this->matchId}",
            'timestamp' => microtime(true),
        ];
    }
}
