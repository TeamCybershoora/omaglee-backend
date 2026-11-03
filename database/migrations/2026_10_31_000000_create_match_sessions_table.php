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
        Schema::create('match_sessions', function (Blueprint $table) {
            $table->string('id', 64)->primary();
            $table->string('status', 24)->default('pending')->index();
            $table->string('participant_a_id', 64)->nullable()->index();
            $table->string('participant_b_id', 64)->nullable()->index();
            $table->string('participant_a_token', 128)->nullable();
            $table->string('participant_b_token', 128)->nullable();
            $table->unsignedInteger('message_sequence')->default(0);
            $table->json('metadata')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('match_sessions');
    }
};
