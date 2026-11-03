<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\CleanupService;

class OmagleeCleanupCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'omaglee:cleanup';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Automated cleanup of expired sessions, stale queue items, and old match history.';

    /**
     * Execute the console command.
     */
    public function handle(CleanupService $cleanupService): int
    {
        $this->info('Starting Omaglee automated cleanup routine...');
        $summary = $cleanupService->runAll();

        $this->table(
            ['Metric', 'Count / Value'],
            [
                ['Expired Sessions', $summary['expired_sessions'] ?? 0],
                ['Pruned Queue Entries', $summary['pruned_queue_entries'] ?? 0],
                ['Pruned Old Matches', $summary['pruned_old_matches'] ?? 0],
                ['Pruned Audit Logs', $summary['pruned_audit_logs'] ?? 0],
                ['Execution Time', $summary['executed_at'] ?? now()->toIso8601String()],
            ]
        );

        $this->info('Omaglee cleanup completed successfully.');
        return Command::SUCCESS;
    }
}
