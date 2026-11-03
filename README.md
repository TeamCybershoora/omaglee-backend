# Omaglee Backend — Centralized Laravel Service

This directory contains the single, centralized **Laravel** backend for the **Omaglee** random video-chat platform. Both `omaglee-web` and `omaglee-admin` communicate with this backend exclusively over HTTP REST APIs.

---

## Architecture Overview

```text
omaglee-backend/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Api/               # API Controllers (HealthCheckController, etc.)
│   │   │   ├── Web/               # Web Route Controllers (HomeController, etc.)
│   │   │   └── Admin/             # Admin API Controllers (DashboardStatusController, etc.)
│   │   ├── Middleware/
│   │   └── Requests/
│   ├── Models/                    # Eloquent Models (User, etc.)
│   ├── Services/                  # Business Logic Services
│   └── Events/                    # Application Events
├── bootstrap/                     # Laravel 11 Application bootstrap
├── config/                        # Configuration files (cors, database, app, session, cache)
├── database/
│   ├── migrations/                # Schema migrations
│   ├── factories/
│   └── seeders/
├── public/                        # Web root & front controller (index.php)
├── routes/
│   ├── api.php                    # REST API routes (/api/health, /api/status, /api/admin/...)
│   ├── web.php                    # Web routes
│   └── console.php                # CLI console commands
├── storage/                       # Cache, session, and log storage
├── .env                           # Local environment configuration
├── .env.example                   # Environment template
└── composer.json                  # Laravel 11 dependencies specification
```

---

## Database Configuration (ServerByt Hosting)

The MySQL database must be created manually through your **ServerByt hosting cPanel**.

1. Log into your **ServerByt cPanel**.
2. Go to **MySQL Databases** and create a new database (e.g. `cpaneluser_omaglee`).
3. Create a MySQL user with a strong password and assign all privileges to the new database.
4. Copy the credentials into `omaglee-backend/.env`:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1          # or remote ServerByt DB host if external
DB_PORT=3306
DB_DATABASE=your_database_name
DB_USERNAME=your_database_user
DB_PASSWORD=your_database_password
```

> **Security Note:** Never commit `.env` containing live ServerByt credentials to version control. The `.gitignore` file is pre-configured to protect `.env`.

---

## Setup & Running the Backend

Once PHP (>= 8.2) and Composer are available in your environment:

1. **Install Dependencies:**
   ```bash
   composer install
   ```

2. **Generate Application Key:**
   ```bash
   php artisan key:generate
   ```

3. **Run Migrations (after ServerByt DB credentials are set):**
   ```bash
   php artisan migrate
   ```

4. **Start Local Development Server:**
   ```bash
   php artisan serve --port=8000
   ```

---

## Minimal Endpoints (Phase 1)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check endpoint returning backend status & DB connectivity state |
| `GET` | `/api/status` | Operational status for frontends |
| `GET` | `/api/admin/overview` | High-level administrative metric status for `omaglee-admin` |
| `GET` | `/` | Web root / status page |

---

## Phase Boundary

In accordance with Phase 1 specifications:
- Matchmaking pipelines, WebRTC signaling (Reverb/Echo), moderation bans, and reporting systems are reserved for upcoming phases.
- No unnecessary database tables or premature logic have been added.
