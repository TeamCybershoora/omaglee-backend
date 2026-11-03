<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MatchCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $matchId;
    public string $participantAId;
    public string $participantBId;
    public float $timestamp;

    public function __construct(string $matchId, string $participantAId, string $participantBId, ?float $timestamp = null)
    {
        $this->matchId = $matchId;
        $this->participantAId = $participantAId;
        $this->participantBId = $participantBId;
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
        return 'match.created';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'participantAId' => $this->participantAId,
            'participantBId' => $this->participantBId,
            'timestamp' => $this->timestamp,
        ];
    }
}
