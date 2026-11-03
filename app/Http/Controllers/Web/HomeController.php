<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;

class HomeController extends Controller
{
    /**
     * Display the backend status page.
     */
    public function index()
    {
        if (view()->exists('welcome')) {
            return view('welcome');
        }

        return response()->json([
            'message' => 'Omaglee Centralized Laravel Backend API',
            'phase' => 'Phase 1 — Foundation Setup',
            'health_endpoint' => url('/api/health'),
            'admin_overview' => url('/api/admin/overview'),
        ]);
    }
}
