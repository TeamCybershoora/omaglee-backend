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
        Schema::create('blocked_users', function (Blueprint $table) {
            $table->id();
            $table->string('blocker_session_uuid', 64)->index();
            $table->string('blocked_session_uuid', 64)->index();
            $table->unsignedBigInteger('blocker_user_id')->nullable()->index();
            $table->unsignedBigInteger('blocked_user_id')->nullable()->index();
            $table->timestamp('created_at')->useCurrent();

            // Uniqueness constraint to prevent duplicate block records
            $table->unique(['blocker_session_uuid', 'blocked_session_uuid']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('blocked_users');
    }
};
