<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('match_sessions', function (Blueprint $table) {
            $table->string('ended_reason', 32)->nullable()->after('ended_at'); // next, disconnect, timeout, cancelled
            $table->timestamp('started_at')->nullable()->after('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('match_sessions', function (Blueprint $table) {
            $table->dropColumn(['ended_reason', 'started_at']);
        });
    }
};
