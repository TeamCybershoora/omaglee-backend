<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Web\HomeController;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Centralized backend web status entry point.
|
*/

Route::get('/', [HomeController::class, 'index'])->name('home');
