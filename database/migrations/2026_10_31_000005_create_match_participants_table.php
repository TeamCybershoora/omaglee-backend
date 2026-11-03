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
        Schema::create('match_participants', function (Blueprint $table) {
            $table->id();
            $table->string('match_id', 64)->index();
            $table->unsignedBigInteger('anonymous_session_id')->nullable()->index();
            $table->string('session_uuid', 64)->index();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('role', 24)->default('initiator'); // initiator, receiver
            $table->string('participant_token_hash', 128)->nullable();
            $table->string('participant_status', 24)->default('joined')->index(); // joined, active, disconnected, abandoned
            $table->timestamp('joined_at')->useCurrent();
            $table->timestamp('disconnected_at')->nullable();
            $table->timestamps();

            // Compound index for fast lookup of a participant's match history
            $table->index(['session_uuid', 'participant_status']);
            $table->index(['match_id', 'session_uuid']);

            // Foreign keys
            $table->foreign('anonymous_session_id')
                ->references('id')
                ->on('anonymous_sessions')
                ->nullOnDelete();

            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('match_participants');
    }
};
