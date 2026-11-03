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
        Schema::create('reports', function (Blueprint $table) {
            $table->id();
            $table->string('reporter_session_uuid', 64)->index();
            $table->string('reported_session_uuid', 64)->index();
            $table->unsignedBigInteger('reporter_user_id')->nullable()->index();
            $table->unsignedBigInteger('reported_user_id')->nullable()->index();
            $table->string('match_id', 64)->nullable()->index();
            $table->string('reason', 64)->index(); // nudity_inappropriate, harassment, hate_speech, spam_bot, underage, other
            $table->text('description')->nullable();
            $table->string('status', 24)->default('pending')->index(); // pending, reviewed, actioned, dismissed
            $table->unsignedBigInteger('reviewed_by_admin_id')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            // Compound lookup index
            $table->index(['reported_session_uuid', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('reports');
    }
};
