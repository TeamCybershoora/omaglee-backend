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
        Schema::create('bans', function (Blueprint $table) {
            $table->id();
            $table->string('subject_session_uuid', 64)->nullable()->index();
            $table->unsignedBigInteger('subject_user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable()->index();
            $table->string('reason', 255);
            $table->string('status', 24)->default('active')->index(); // active, expired, revoked
            $table->timestamp('starts_at')->useCurrent();
            $table->timestamp('expires_at')->nullable()->index();
            $table->unsignedBigInteger('moderator_id')->nullable();
            $table->timestamps();

            // Compound lookup index for active bans check
            $table->index(['ip_address', 'status', 'expires_at']);
            $table->index(['subject_session_uuid', 'status', 'expires_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('bans');
    }
};
