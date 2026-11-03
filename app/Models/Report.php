<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Report extends Model
{
    use HasFactory;

    protected $table = 'reports';

    protected $fillable = [
        'report_uuid',
        'reporter_session_uuid',
        'reported_session_uuid',
        'reporter_user_id',
        'reported_user_id',
        'match_id',
        'reason',
        'description',
        'status',
        'reviewed_by_admin_id',
        'reviewed_at',
        'resolution',
        'ban_id',
    ];

    protected $casts = [
        'reviewed_at' => 'datetime',
    ];
}
