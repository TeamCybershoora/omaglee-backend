<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class IceCandidateReceived implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $matchId;
    public string $senderId;
    public $candidate;
    public string $messageId;
    public int $sequenceNumber;
    public float $timestamp;

    public function __construct(string $matchId, string $senderId, $candidate, string $messageId, int $sequenceNumber, ?float $timestamp = null)
    {
        $this->matchId = $matchId;
        $this->senderId = $senderId;
        $this->candidate = $candidate;
        $this->messageId = $messageId;
        $this->sequenceNumber = $sequenceNumber;
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
        return 'webrtc.ice-candidate';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'senderId' => $this->senderId,
            'candidate' => $this->candidate,
            'messageId' => $this->messageId,
            'sequenceNumber' => $this->sequenceNumber,
            'timestamp' => $this->timestamp,
        ];
    }
}
