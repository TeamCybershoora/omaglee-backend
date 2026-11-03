<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Phase 8 Automated Cleanup Schedule (Runs every 10 minutes)
Schedule::command('omaglee:cleanup')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
