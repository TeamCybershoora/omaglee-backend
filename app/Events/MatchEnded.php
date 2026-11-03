<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MatchEnded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $matchId;
    public string $reason;
    public float $timestamp;

    public function __construct(string $matchId, string $reason = 'match_completed', ?float $timestamp = null)
    {
        $this->matchId = $matchId;
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
        return 'match.ended';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'reason' => $this->reason,
            'timestamp' => $this->timestamp,
        ];
    }
}
