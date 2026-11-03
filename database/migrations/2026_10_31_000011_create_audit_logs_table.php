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
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->string('actor_type', 32)->default('system'); // system, session, user, admin
            $table->string('actor_id', 64)->nullable()->index();
            $table->string('action', 64)->index(); // session.created, session.expired, match.created, match.ended, ban.created, report.filed
            $table->string('subject_type', 64)->nullable();
            $table->string('subject_id', 64)->nullable()->index();
            $table->json('metadata')->nullable(); // Safe metadata: no passwords, tokens, or turn secrets
            $table->timestamp('created_at')->useCurrent()->index();

            // Compound lookup index for retention cleanup and event tracing
            $table->index(['action', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
