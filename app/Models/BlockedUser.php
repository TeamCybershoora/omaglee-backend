<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BlockedUser extends Model
{
    use HasFactory;

    protected $table = 'blocked_users';

    public $timestamps = false;

    protected $fillable = [
        'blocker_session_uuid',
        'blocked_session_uuid',
        'blocker_user_id',
        'blocked_user_id',
        'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];
}
