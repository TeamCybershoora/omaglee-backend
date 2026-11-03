<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class UserDisconnected implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $matchId;
    public string $participantId;
    public string $reason;
    public float $timestamp;

    public function __construct(string $matchId, string $participantId, string $reason = 'user_disconnected', ?float $timestamp = null)
    {
        $this->matchId = $matchId;
        $this->participantId = $participantId;
        $this->reason = $reason;
        $this->timestamp = $timestamp ?? microtime(true);
    }

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("match.{$this->matchId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'user.disconnected';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'participantId' => $this->participantId,
            'reason' => $this->reason,
            'timestamp' => $this->timestamp,
        ];
    }
}
