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
        Schema::table('reports', function (Blueprint $table) {
            $table->string('report_uuid', 64)->nullable()->unique()->after('id');
            $table->text('resolution')->nullable()->after('reviewed_at');
            $table->unsignedBigInteger('ban_id')->nullable()->after('resolution');
        });

        Schema::table('bans', function (Blueprint $table) {
            $table->string('ban_type', 24)->default('temporary')->index()->after('reason'); // temporary, permanent
            $table->unsignedBigInteger('report_id')->nullable()->after('moderator_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('reports', function (Blueprint $table) {
            $table->dropColumn(['report_uuid', 'resolution', 'ban_id']);
        });

        Schema::table('bans', function (Blueprint $table) {
            $table->dropColumn(['ban_type', 'report_id']);
        });
    }
};
