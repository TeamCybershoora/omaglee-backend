<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SignalingMessageEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $roomId;
    public string $senderId;
    public ?string $targetId;
    public string $type;
    public $payload;
    public float $timestamp;

    /**
     * Create a new signaling event instance.
     */
    public function __construct(string $roomId, string $senderId, ?string $targetId, string $type, $payload, ?float $timestamp = null)
    {
        $this->roomId = $roomId;
        $this->senderId = $senderId;
        $this->targetId = $targetId;
        $this->type = $type;
        $this->payload = $payload;
        $this->timestamp = $timestamp ?? microtime(true);
    }

    /**
     * Get the channels the event should broadcast on.
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("room.{$this->roomId}"),
        ];
    }

    /**
     * Broadcast event alias.
     */
    public function broadcastAs(): string
    {
        return 'signaling.message';
    }

    /**
     * Broadcast payload array.
     */
    public function broadcastWith(): array
    {
        return [
            'roomId' => $this->roomId,
            'senderId' => $this->senderId,
            'targetId' => $this->targetId,
            'type' => $this->type,
            'payload' => $this->payload,
            'timestamp' => $this->timestamp,
        ];
    }
}
