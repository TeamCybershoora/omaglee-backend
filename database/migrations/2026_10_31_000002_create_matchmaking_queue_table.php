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
        Schema::create('matchmaking_queue', function (Blueprint $table) {
            $table->id();
            $table->string('session_uuid', 64)->index();
            $table->string('status', 24)->default('waiting')->index(); // waiting, reserved, matched, cancelled, expired
            $table->string('match_id', 64)->nullable()->index();
            $table->timestamp('joined_at')->useCurrent()->index();
            $table->timestamp('last_heartbeat_at')->useCurrent()->index();
            $table->timestamp('reserved_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();

            // Prevent multiple active waiting entries for the same session
            $table->index(['session_uuid', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('matchmaking_queue');
    }
};
