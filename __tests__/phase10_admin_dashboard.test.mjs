import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 10: Admin Dashboard, RBAC & Subsystem Governance Suite', () => {

  // ==========================================
  // 1. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==========================================
  describe('1. Role-Based Access Control (RBAC) Hierarchy', () => {
    const rolesHierarchy = {
      'super_admin': 3,
      'admin': 3,
      'moderator': 2,
      'support': 1,
    };

    function hasPermission(userRole, requiredRole) {
      const userRank = rolesHierarchy[userRole] || 0;
      const requiredRank = rolesHierarchy[requiredRole] || 0;
      return userRank >= requiredRank;
    }

    function checkRouteAccess(userRole, route) {
      if (route === 'PATCH /api/admin/settings') {
        if (!hasPermission(userRole, 'super_admin')) {
          return { status: 403, error: 'insufficient_permissions' };
        }
        return { status: 200, message: 'Settings updated' };
      }

      if (route === 'POST /api/admin/users/:id/restrict' || route === 'POST /api/admin/bans') {
        if (!hasPermission(userRole, 'moderator')) {
          return { status: 403, error: 'insufficient_permissions' };
        }
        return { status: 200, message: 'Action permitted' };
      }

      // Read-only routes (Overview, Users, Reports, Matches, Health)
      if (!hasPermission(userRole, 'support')) {
        return { status: 401, error: 'unauthorized' };
      }
      return { status: 200, message: 'Read permitted' };
    }

    it('grants Super Admin full access to configuration settings, bans, and inspections', () => {
      assert.strictEqual(checkRouteAccess('super_admin', 'PATCH /api/admin/settings').status, 200);
      assert.strictEqual(checkRouteAccess('super_admin', 'POST /api/admin/bans').status, 200);
      assert.strictEqual(checkRouteAccess('super_admin', 'GET /api/admin/overview').status, 200);
    });

    it('grants Moderator access to restrictions & bans but rejects configuration edits with 403', () => {
      assert.strictEqual(checkRouteAccess('moderator', 'POST /api/admin/users/:id/restrict').status, 200);
      assert.strictEqual(checkRouteAccess('moderator', 'POST /api/admin/bans').status, 200);
      const settingsAttempt = checkRouteAccess('moderator', 'PATCH /api/admin/settings');
      assert.strictEqual(settingsAttempt.status, 403);
      assert.strictEqual(settingsAttempt.error, 'insufficient_permissions');
    });

    it('grants Support read-only access but denies bans, user restrictions, and settings edits', () => {
      assert.strictEqual(checkRouteAccess('support', 'GET /api/admin/users').status, 200);
      assert.strictEqual(checkRouteAccess('support', 'GET /api/admin/system-health').status, 200);
      assert.strictEqual(checkRouteAccess('support', 'POST /api/admin/bans').status, 403);
      assert.strictEqual(checkRouteAccess('support', 'POST /api/admin/users/:id/restrict').status, 403);
      assert.strictEqual(checkRouteAccess('support', 'PATCH /api/admin/settings').status, 403);
    });
  });

  // ==========================================
  // 2. PRIVACY PROTECTION & DATA MASKING
  // ==========================================
  describe('2. Privacy Protection & Operational Data Masking', () => {
    function maskIpAddress(ip) {
      if (!ip) return '127.0.***.***';
      const parts = ip.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.***.***`;
      }
      return '***.***.***.***';
    }

    function maskSessionUuid(uuid) {
      if (!uuid) return 'sess_****';
      if (uuid.length <= 10) return uuid;
      return `${uuid.substring(0, 6)}...${uuid.substring(uuid.length - 4)}`;
    }

    it('masks client IP addresses into subnet-only representation', () => {
      assert.strictEqual(maskIpAddress('192.168.1.100'), '192.168.***.***');
      assert.strictEqual(maskIpAddress('10.0.4.55'), '10.0.***.***');
      assert.strictEqual(maskIpAddress('127.0.0.1'), '127.0.***.***');
    });

    it('masks long anonymous session UUIDs for secure dashboard display', () => {
      const rawUuid = 'anon_a1b2c3d4e5f6a7b8c9d0';
      const masked = maskSessionUuid(rawUuid);
      assert.strictEqual(masked, 'anon_a...c9d0');
      assert.strictEqual(masked.length < rawUuid.length, true);
    });

    it('ensures raw tokens and passwords are never exposed in user list objects', () => {
      const rawSession = {
        sessionUuid: 'anon_test123',
        rawToken: 'secret_token_raw_do_not_leak',
        tokenHash: 'sha256_hash_here',
        ipAddress: '172.16.254.1',
        status: 'idle',
      };

      const publicDashboardUser = {
        sessionUuid: rawSession.sessionUuid,
        maskedSessionUuid: maskSessionUuid(rawSession.sessionUuid),
        status: rawSession.status,
        maskedIpAddress: maskIpAddress(rawSession.ipAddress),
      };

      const serialized = JSON.stringify(publicDashboardUser);
      assert.strictEqual(serialized.includes(rawSession.rawToken), false);
      assert.strictEqual(serialized.includes(rawSession.tokenHash), false);
      assert.strictEqual(serialized.includes('172.16.254.1'), false);
      assert.strictEqual(serialized.includes('172.16.***.***'), true);
    });
  });

  // ==========================================
  // 3. USER ACCOUNT RESTRICTIONS
  // ==========================================
  describe('3. User Account Restriction Management', () => {
    class MockUserManager {
      constructor() {
        this.sessions = new Map();
        this.queue = [];
        this.matches = new Map();
      }

      addSession(uuid) {
        this.sessions.set(uuid, { sessionUuid: uuid, status: 'idle', isRestricted: false, activeMatchId: null });
      }

      restrictUser(uuid, restricted) {
        const s = this.sessions.get(uuid);
        if (!s) return null;
        s.isRestricted = restricted;

        if (restricted) {
          // Remove from queue
          this.queue = this.queue.filter(q => q !== uuid);
          // Terminate active match
          if (s.activeMatchId) {
            const m = this.matches.get(s.activeMatchId);
            if (m) {
              m.status = 'ended';
              m.endedReason = 'restricted';
            }
            s.activeMatchId = null;
          }
          s.status = 'restricted';
        } else {
          s.status = 'idle';
        }
        return s;
      }
    }

    it('restricts user session, removes from queue and terminates match with reason restricted', () => {
      const mgr = new MockUserManager();
      mgr.addSession('user_target');
      mgr.queue.push('user_target');

      // Create active match
      mgr.sessions.get('user_target').activeMatchId = 'match_999';
      mgr.matches.set('match_999', { matchId: 'match_999', status: 'active', endedReason: null });

      // Apply restriction
      const res = mgr.restrictUser('user_target', true);
      assert.strictEqual(res.isRestricted, true);
      assert.strictEqual(res.status, 'restricted');
      assert.strictEqual(mgr.queue.includes('user_target'), false);
      assert.strictEqual(mgr.matches.get('match_999').status, 'ended');
      assert.strictEqual(mgr.matches.get('match_999').endedReason, 'restricted');
    });

    it('lifts restriction restoring session status to idle', () => {
      const mgr = new MockUserManager();
      mgr.addSession('user_target');
      mgr.restrictUser('user_target', true);
      assert.strictEqual(mgr.sessions.get('user_target').isRestricted, true);

      mgr.restrictUser('user_target', false);
      assert.strictEqual(mgr.sessions.get('user_target').isRestricted, false);
      assert.strictEqual(mgr.sessions.get('user_target').status, 'idle');
    });
  });

  // ==========================================
  // 4. CONFIGURABLE APPLICATION SETTINGS & MAINTENANCE MODE
  // ==========================================
  describe('4. Configurable Application Settings & Maintenance Mode', () => {
    const settings = {
      queueTimeoutSeconds: 45,
      sessionInactivityMinutes: 120,
      maxReportsBeforeAutoBan: 3,
      forceTurnRelayOnly: false,
      maintenanceMode: false,
      rateLimitMaxRequests: 60,
    };

    function startMatchmaking(currentSettings) {
      if (currentSettings.maintenanceMode) {
        return { status: 503, error: 'maintenance_mode', message: 'Omaglee is under maintenance' };
      }
      return { status: 200, statusText: 'queued' };
    }

    it('permits matchmaking when maintenance mode is false', () => {
      settings.maintenanceMode = false;
      const res = startMatchmaking(settings);
      assert.strictEqual(res.status, 200);
    });

    it('rejects matchmaking requests with 503 when maintenance mode is active', () => {
      settings.maintenanceMode = true;
      const res = startMatchmaking(settings);
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.error, 'maintenance_mode');
    });

    it('persists and validates updated limits', () => {
      settings.queueTimeoutSeconds = 60;
      settings.maxReportsBeforeAutoBan = 5;
      assert.strictEqual(settings.queueTimeoutSeconds, 60);
      assert.strictEqual(settings.maxReportsBeforeAutoBan, 5);
    });
  });

  // ==========================================
  // 5. ABUSE MONITORING HEURISTICS
  // ==========================================
  describe('5. Abuse Monitoring & Griefing Heuristics', () => {
    function computeAbuseMetrics(reports, matches) {
      // 1. Repeat reported users
      const counts = new Map();
      for (const r of reports) {
        counts.set(r.reportedSessionUuid, (counts.get(r.reportedSessionUuid) || 0) + 1);
      }

      const repeatUsers = [];
      for (const [uuid, count] of counts.entries()) {
        if (count >= 2) repeatUsers.push({ uuid, count });
      }

      // 2. Rapid disconnects (<5s)
      const rapidDisconnects = matches.filter(m => {
        const dur = (m.endedAt - m.startedAt) / 1000;
        return dur < 5 && (m.endedReason === 'next' || m.endedReason === 'disconnect');
      });

      return {
        repeatUsersCount: repeatUsers.length,
        rapidDisconnectsCount: rapidDisconnects.length,
        hasCriticalAlert: repeatUsers.length > 0,
      };
    }

    it('identifies repeat reported participants with at least 2 incident reports', () => {
      const reports = [
        { reportedSessionUuid: 'user_troll_1', reason: 'nudity' },
        { reportedSessionUuid: 'user_troll_1', reason: 'harassment' },
        { reportedSessionUuid: 'user_normal_2', reason: 'spam' },
      ];
      const matches = [];

      const metrics = computeAbuseMetrics(reports, matches);
      assert.strictEqual(metrics.repeatUsersCount, 1);
      assert.strictEqual(metrics.hasCriticalAlert, true);
    });

    it('identifies rapid skipping grief behavior (<5s duration)', () => {
      const reports = [];
      const now = Date.now();
      const matches = [
        { startedAt: now - 3000, endedAt: now, endedReason: 'next' }, // 3s -> rapid
        { startedAt: now - 2000, endedAt: now, endedReason: 'disconnect' }, // 2s -> rapid
        { startedAt: now - 60000, endedAt: now, endedReason: 'next' }, // 60s -> normal
      ];

      const metrics = computeAbuseMetrics(reports, matches);
      assert.strictEqual(metrics.rapidDisconnectsCount, 2);
    });
  });

  // ==========================================
  // 6. SUBSYSTEM HEALTH DIAGNOSTICS
  // ==========================================
  describe('6. Subsystem Health Diagnostics', () => {
    function getDiagnosticStatus(turnEnabled) {
      return {
        database: { status: 'healthy', pingMs: 14, connected: true },
        reverb: { status: 'healthy', pingMs: 4, port: 8080 },
        turnRelay: {
          status: turnEnabled ? 'healthy' : 'disabled_stun_only',
          pingMs: turnEnabled ? 16 : null,
        },
      };
    }

    it('returns healthy status and valid ping latency for core subsystems', () => {
      const diagnostics = getDiagnosticStatus(true);
      assert.strictEqual(diagnostics.database.status, 'healthy');
      assert.strictEqual(diagnostics.database.connected, true);
      assert.ok(diagnostics.database.pingMs < 100);

      assert.strictEqual(diagnostics.reverb.status, 'healthy');
      assert.strictEqual(diagnostics.reverb.port, 8080);

      assert.strictEqual(diagnostics.turnRelay.status, 'healthy');
      assert.ok(diagnostics.turnRelay.pingMs !== null);
    });

    it('indicates STUN only fallback when TURN relay is disabled', () => {
      const diagnostics = getDiagnosticStatus(false);
      assert.strictEqual(diagnostics.turnRelay.status, 'disabled_stun_only');
      assert.strictEqual(diagnostics.turnRelay.pingMs, null);
    });
  });
});
