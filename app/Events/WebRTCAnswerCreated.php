<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class WebRTCAnswerCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $matchId;
    public string $senderId;
    public $sdp;
    public string $messageId;
    public int $sequenceNumber;
    public float $timestamp;

    public function __construct(string $matchId, string $senderId, $sdp, string $messageId, int $sequenceNumber, ?float $timestamp = null)
    {
        $this->matchId = $matchId;
        $this->senderId = $senderId;
        $this->sdp = $sdp;
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
        return 'webrtc.answer';
    }

    public function broadcastWith(): array
    {
        return [
            'matchId' => $this->matchId,
            'senderId' => $this->senderId,
            'sdp' => $this->sdp,
            'messageId' => $this->messageId,
            'sequenceNumber' => $this->sequenceNumber,
            'timestamp' => $this->timestamp,
        ];
    }
}
