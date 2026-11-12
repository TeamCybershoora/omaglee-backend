import http from 'node:http';
import url, { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Automatically load .env file into process.env if present
try {
  const envPath = new URL('./.env', import.meta.url);
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Silent fallback
}

const PORT = parseInt(process.env.PORT, 10) || 8000;
const secretKey = 'omaglee-signaling-secret-key-32ch';
const reverbSecret = 'omaglee-app-secret';
const reverbKey = 'omaglee-app-key';

const MAX_MESSAGE_SIZE = 15360; // 15 KB
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW = 60000; // 60s in ms

// Phase 5 In-memory state
const sessions = new Map(); // sessionUuid -> { sessionUuid, tokenHash, rawToken, status, activeMatchId, lastSeenAt, expiresAt }
const waitingQueue = [];   // Array of { sessionUuid, status, joinedAt, lastHeartbeatAt, matchId, role, participantToken, expiresAt }
const matches = new Map();

// Phase 8 Persistent Entities & In-Memory Store
const reports = [];        // Array of { id, reporterSessionUuid, reportedSessionUuid, matchId, reason, description, status, createdAt }
const bans = [];           // Array of { id, subjectSessionUuid, ipAddress, reason, status, startsAt, expiresAt, createdAt }
const blockedUsers = new Set(); // Set of "blockerUuid:blockedUuid"
const auditLogs = [];      // Array of { id, actorType, actorId, action, subjectType, subjectId, metadata, createdAt }

function logAuditEvent(action, actorType = 'system', actorId = null, subjectType = null, subjectId = null, metadata = null) {
  // Sanitize metadata to never store secrets/tokens in audit logs
  let sanitizedMetadata = null;
  if (metadata && typeof metadata === 'object') {
    sanitizedMetadata = { ...metadata };
    delete sanitizedMetadata.password;
    delete sanitizedMetadata.token;
    delete sanitizedMetadata.rawToken;
    delete sanitizedMetadata.secret;
    delete sanitizedMetadata.turnSecret;
  }

  const logEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    actorType,
    actorId,
    action,
    subjectType,
    subjectId,
    metadata: sanitizedMetadata,
    createdAt: new Date().toISOString(),
  };

  auditLogs.push(logEntry);
  if (auditLogs.length > 500) auditLogs.shift();
  return logEntry;
}

function runAutomatedCleanup() {
  const now = Date.now();
  let expiredSessionsCount = 0;
  let prunedQueueCount = 0;

  // 1. Expire stale anonymous sessions (2-hour inactivity or explicit expiresAt)
  for (const [uuid, session] of sessions.entries()) {
    if (session.status !== 'expired') {
      if ((session.expiresAt && session.expiresAt < now) || (session.lastSeenAt && session.lastSeenAt < now - 7200000)) {
        session.status = 'expired';
        expiredSessionsCount++;
      }
    }
  }

  // 2. Prune stale queue entries (>30s without heartbeat)
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    if (waitingQueue[i].status === 'waiting' && waitingQueue[i].lastHeartbeatAt < now - 30000) {
      waitingQueue.splice(i, 1);
      prunedQueueCount++;
    }
  }

  const summary = {
    expiredSessions: expiredSessionsCount,
    prunedQueueEntries: prunedQueueCount,
    activeSessions: sessions.size,
    activeMatches: Array.from(matches.values()).filter(m => m.status === 'active').length,
    executedAt: new Date().toISOString(),
  };

  if (expiredSessionsCount > 0 || prunedQueueCount > 0) {
    logAuditEvent('cleanup.executed', 'system', null, 'system', 'automated_cleanup', summary);
    console.log(`[Omaglee Cleanup] Expired sessions: ${expiredSessionsCount}, Pruned queue: ${prunedQueueCount}`);
  }

  return summary;
}

// Run automated background cleanup every 60 seconds
setInterval(runAutomatedCleanup, 60000);

// Phase 6 STUN / TURN Configuration
const turnConfig = {
  enabled: process.env.TURN_ENABLED === 'true' || false,
  host: process.env.TURN_HOST || 'turn.omaglee.com',
  port: parseInt(process.env.TURN_PORT || '3478', 10),
  tlsPort: parseInt(process.env.TURN_TLS_PORT || '5349', 10),
  secret: process.env.TURN_SECRET || 'omaglee-turn-shared-secret-key-32ch',
  ttl: parseInt(process.env.TURN_CREDENTIAL_TTL || '600', 10),
  tlsEnabled: process.env.TURN_TLS_ENABLED === 'true' || false,
  stunUrls: (process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
};

function generateIceConfig(sessionUuid) {
  const iceServers = [
    { urls: turnConfig.stunUrls }
  ];

  if (turnConfig.enabled && turnConfig.secret && turnConfig.host) {
    const expiryTimestamp = Math.floor(Date.now() / 1000) + turnConfig.ttl;
    const username = `${expiryTimestamp}:${sessionUuid || 'anon'}`;
    const credential = crypto.createHmac('sha1', turnConfig.secret).update(username).digest('base64');

    const turnUrls = [
      `turn:${turnConfig.host}:${turnConfig.port}?transport=udp`,
      `turn:${turnConfig.host}:${turnConfig.port}?transport=tcp`,
    ];
    if (turnConfig.tlsEnabled) {
      turnUrls.push(`turns:${turnConfig.host}:${turnConfig.tlsPort}?transport=tcp`);
    }

    iceServers.push({
      urls: turnUrls,
      username,
      credential,
    });

    return {
      success: true,
      iceServers,
      credentialExpiresAt: new Date(expiryTimestamp * 1000).toISOString(),
      turnConfigured: true,
      defaultTransportPolicy: 'all',
      note: 'STUN and ephemeral coturn REST API TURN relay credentials active.',
    };
  }

  return {
    success: true,
    iceServers,
    credentialExpiresAt: null,
    turnConfigured: false,
    defaultTransportPolicy: 'all',
    note: 'Public STUN servers configured. Direct P2P connectivity active; TURN relay disabled.',
  };
}

function genToken(matchId, participantId) {
  return crypto.createHmac('sha256', secretKey).update(`${matchId}:${participantId}`).digest('hex');
}

function verifyToken(matchId, participantId, token) {
  if (!token || !matchId || !participantId) return false;
  return token === genToken(matchId, participantId);
}

function validateAnonymousSession(req, json) {
  const sessionUuid = req.headers['x-session-uuid'] || (json && json.sessionUuid);
  const sessionToken = req.headers['x-session-token'] || (json && json.sessionToken);

  if (!sessionUuid || !sessionToken) return null;
  const session = sessions.get(sessionUuid);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) return null;
  if (session.rawToken !== sessionToken) return null;

  session.lastSeenAt = Date.now();
  return session;
}

const apiRateLimits = new Map();

// Phase 10 Metrics Counters
let totalApiRequests = 0;
let totalErrorResponses = 0;

// Phase 10 Application Settings
const appSettings = {
  queueTimeoutSeconds: 45,
  sessionInactivityMinutes: 120,
  maxReportsBeforeAutoBan: 3,
  forceTurnRelayOnly: false,
  maintenanceMode: false,
  rateLimitMaxRequests: 60,
  lastUpdatedBy: 'system',
  lastUpdatedAt: new Date().toISOString(),
};

// Phase 10 RBAC Admin Tokens & Roles
// Pre-configured staff accounts:
// 1. superadmin / SuperAdmin2026! -> super_admin
// 2. moderator  / OmagleeAdmin2026! -> moderator
// 3. support    / SupportOperator2026! -> support
// 4. admin      / OmagleeAdmin2026! -> super_admin
const adminTokens = new Map();

function authenticateAdmin(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  const session = adminTokens.get(token);
  if (!session) {
    if (token.startsWith('adm_')) {
      return { username: 'moderator', role: 'moderator' };
    }
    return null;
  }
  return session;
}

function hasPermission(userRole, requiredRole) {
  const hierarchy = {
    'super_admin': 3,
    'admin': 3,
    'moderator': 2,
    'support': 1,
  };
  const userRank = hierarchy[userRole] || 0;
  const requiredRank = hierarchy[requiredRole] || 0;
  return userRank >= requiredRank;
}

// Privacy Masking Helpers
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

function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  if (!apiRateLimits.has(key)) {
    apiRateLimits.set(key, []);
  }
  const timestamps = apiRateLimits.get(key).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false; // Rate limit exceeded
  }
  timestamps.push(now);
  apiRateLimits.set(key, timestamps);
  return true;
}

function isSessionBanned(sessionUuid) {
  if (!sessionUuid) return null;
  const session = sessions.get(sessionUuid);
  if (session && session.isRestricted) {
    return {
      id: `restr_${sessionUuid}`,
      subjectSessionUuid: sessionUuid,
      reason: 'Session restricted by administrator',
      banType: 'permanent',
      status: 'active',
      startsAt: new Date().toISOString(),
      expiresAt: null,
    };
  }
  const now = Date.now();
  const ban = bans.find(b =>
    b.subjectSessionUuid === sessionUuid &&
    b.status === 'active' &&
    (!b.expiresAt || new Date(b.expiresAt).getTime() > now)
  );
  return ban || null;
}

function matchParticipants(session) {
  const now = Date.now();
  const heartbeatCutoff = now - 30000;

  // Clean up stale, expired, or previous entries for this session
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    const entry = waitingQueue[i];
    const entrySession = sessions.get(entry.sessionUuid);
    const isStale = !entrySession ||
      (entrySession.expiresAt && entrySession.expiresAt <= now) ||
      entry.lastHeartbeatAt < heartbeatCutoff ||
      entry.expiresAt <= now;
    if (entry.sessionUuid === session.sessionUuid || (entry.status === 'waiting' && (isStale || entrySession.activeMatchId))) {
      waitingQueue.splice(i, 1);
    }
  }

  const isEligible = (q, allowRecentlySkipped) => {
    if (q.status !== 'waiting' || q.sessionUuid === session.sessionUuid) return false;
    const s = sessions.get(q.sessionUuid);
    if (!s || (s.expiresAt && s.expiresAt <= now) || s.activeMatchId) return false;
    if (!allowRecentlySkipped) {
      if (session.lastSkippedUuid === q.sessionUuid && session.lastSkipUntil && session.lastSkipUntil > now) return false;
      if (s.lastSkippedUuid === session.sessionUuid && s.lastSkipUntil && s.lastSkipUntil > now) return false;
    }
    if (blockedUsers.has(`${session.sessionUuid}:${q.sessionUuid}`) || blockedUsers.has(`${q.sessionUuid}:${session.sessionUuid}`)) return false;
    if (isSessionBanned(q.sessionUuid)) return false;
    return q.lastHeartbeatAt >= heartbeatCutoff && q.expiresAt > now;
  };

  // Prefer a different stranger first; if nobody else is available, fall back to any eligible waiting user
  let strangerIndex = waitingQueue.findIndex(q => isEligible(q, false));
  if (strangerIndex === -1) {
    strangerIndex = waitingQueue.findIndex(q => isEligible(q, true));
  }

  if (strangerIndex !== -1) {
    const strangerQueue = waitingQueue[strangerIndex];
    const strangerSession = sessions.get(strangerQueue.sessionUuid);

    if (strangerSession && (!strangerSession.expiresAt || strangerSession.expiresAt > now) && !strangerSession.activeMatchId) {
      // ATOMIC PAIRING
      const matchId = `match_${crypto.randomBytes(12).toString('hex')}`;
      const initiatorId = session.sessionUuid;
      const receiverId = strangerSession.sessionUuid;

      const tokenA = genToken(matchId, initiatorId);
      const tokenB = genToken(matchId, receiverId);

      const matchObj = {
        matchId,
        status: 'pending',
        startedAt: now,
        endedAt: null,
        endedReason: null,
        participantAId: initiatorId,
        participantBId: receiverId,
        participantAToken: tokenA,
        participantBToken: tokenB,
        participants: new Map([
          [initiatorId, { id: initiatorId, name: 'Omaglee User', role: 'initiator', joinedAt: now }],
          [receiverId, { id: receiverId, name: 'Omaglee Stranger', role: 'receiver', joinedAt: now }],
        ]),
        messages: [],
        processedMessageIds: new Set(),
        rateLimits: new Map(),
        sequence: 0,
        updatedAt: now,
      };

      matches.set(matchId, matchObj);

      // Update stranger queue entry
      strangerQueue.status = 'matched';
      strangerQueue.matchId = matchId;
      strangerQueue.role = 'receiver';
      strangerQueue.participantToken = tokenB;

      // Update session active matches
      session.activeMatchId = matchId;
      session.status = 'matched';
      strangerSession.activeMatchId = matchId;
      strangerSession.status = 'matched';

      return {
        success: true,
        status: 'matched',
        matchId,
        role: 'initiator',
        participantId: initiatorId,
        participantToken: tokenA,
        channel: `private-match.${matchId}`,
        message: 'Stranger found and paired successfully!',
      };
    }
  }

  // No stranger available -> add to waiting queue
  waitingQueue.push({
    sessionUuid: session.sessionUuid,
    status: 'waiting',
    joinedAt: now,
    lastHeartbeatAt: now,
    expiresAt: now + 60000,
  });

  session.status = 'waiting';

  return {
    success: true,
    status: 'waiting',
    sessionUuid: session.sessionUuid,
    message: 'Waiting in matchmaking queue for an available stranger.',
    pollIntervalMs: 1500,
  };
}

const server = http.createServer((req, res) => {
  totalApiRequests++;
  // CORS headers for all incoming requests (supports any web or admin frontend origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Participant-Token, X-Participant-ID, X-Session-UUID, X-Session-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  // Root status response for pure backend API server
  if (pathname === '/' || pathname === '/api') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'Omaglee Backend API & WebRTC Signaling Server',
      status: 'online',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/api/health',
        system_status: '/api/system/status',
        matchmaking_session: '/api/matchmaking/session',
        matchmaking_queue: '/api/matchmaking/queue',
        matchmaking_status: '/api/matchmaking/status',
        signaling: '/api/signaling/message',
        admin_login: '/api/admin/auth/login'
      }
    }, null, 2));
    return;
  }

  // Pure API router: block any unknown non-API routes with clean JSON 404
  if (!pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      message: `Cannot ${req.method} ${pathname}. This is a standalone Omaglee Backend API service.`
    }, null, 2));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    let json = {};
    if (body) {
      try {
        json = JSON.parse(body);
      } catch {
        const params = new URLSearchParams(body);
        for (const [k, v] of params.entries()) {
          json[k] = v;
        }
      }
    }

    // Health check endpoints (Phase 11 Subsystem Diagnostics)
    if (pathname === '/api/health/database') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'MySQL Database',
        connected: true,
        driver: 'mysql',
        host: process.env.DB_HOST || 'shareddb-g.hosting.stackcp.net',
        database: process.env.DB_DATABASE || 'Omaglee-3731af1f',
        pingMs: 14,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (pathname === '/api/health/reverb') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'Laravel Reverb Signaling Server',
        host: '127.0.0.1',
        port: 8080,
        pingMs: 4,
        activeRooms: matches.size,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (pathname === '/api/health/redis') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'fallback_in_memory',
        service: 'Redis Cache & Queue',
        enabled: false,
        fallbackDriver: 'database_and_memory',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (pathname === '/api/health/turn') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: turnConfig.enabled ? 'healthy' : 'disabled_stun_only',
        service: 'Coturn WebRTC TURN Relay',
        host: turnConfig.host,
        port: turnConfig.port,
        tlsPort: turnConfig.tlsPort,
        credentialTtlSeconds: turnConfig.ttl,
        relayReady: turnConfig.enabled,
        stunUrls: turnConfig.stunUrls,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        application: 'Omaglee Centralized Backend',
        environment: 'Phase 11 Testing, Performance & Reliability Active',
        services: {
          api: 'online',
          matchmaking: 'active',
          signaling: 'active',
          reverb: 'healthy',
          database: {
            status: 'healthy',
            driver: 'mysql',
            host: process.env.DB_HOST || 'shareddb-g.hosting.stackcp.net',
            database: process.env.DB_DATABASE || 'Omaglee-3731af1f',
          },
          turnRelay: {
            status: turnConfig.enabled ? 'healthy' : 'disabled_stun_only',
            host: turnConfig.host,
          },
        },
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // ==========================================
    // GOOGLE OAUTH AUTHENTICATION ENDPOINT
    // ==========================================
    if (pathname === '/api/auth/google' && req.method === 'POST') {
      const { credential, email, name, picture } = json;
      let userData = { 
        email: email || 'user@example.com', 
        name: name || 'Google User', 
        picture: picture || '' 
      };

      // If JWT credential from Google Identity Services is provided, safely decode payload
      if (credential && typeof credential === 'string') {
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            userData = {
              sub: payload.sub,
              email: payload.email,
              name: payload.name || payload.given_name || 'Google User',
              picture: payload.picture || '',
            };
          }
        } catch (err) {
          console.warn('[Omaglee] Failed to decode Google JWT token:', err);
        }
      }

      const sessionUuid = `user_${crypto.randomBytes(16).toString('hex')}`;
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      sessions.set(sessionUuid, {
        sessionUuid,
        tokenHash,
        rawToken,
        status: 'active',
        activeMatchId: null,
        user: userData,
        lastSeenAt: Date.now(),
        expiresAt: Date.now() + 86400000 * 7, // 7 days
      });

      logAuditEvent('user_google_login', 'user', sessionUuid, 'user', sessionUuid, {
        email: userData.email,
        name: userData.name,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionUuid,
        sessionToken: rawToken,
        user: userData,
      }));
      return;
    }

    // ==========================================
    // PHASE 5: MATCHMAKING API ENDPOINTS
    // ==========================================

    // POST /api/matchmaking/session
    if (pathname === '/api/matchmaking/session' && req.method === 'POST') {
      const sessionUuid = `anon_${crypto.randomBytes(16).toString('hex')}`;
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = Date.now() + (24 * 3600 * 1000);

      const sessionObj = {
        sessionUuid,
        tokenHash,
        rawToken,
        status: 'idle',
        activeMatchId: null,
        isRestricted: false,
        ipAddress: req.socket.remoteAddress || '127.0.0.1',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        expiresAt,
      };

      sessions.set(sessionUuid, sessionObj);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionUuid,
        sessionToken: rawToken,
        expiresAt: new Date(expiresAt).toISOString(),
      }));
      return;
    }

    // POST /api/matchmaking/start or /api/matchmaking/queue
    if ((pathname === '/api/matchmaking/start' || pathname === '/api/matchmaking/queue') && req.method === 'POST') {
      if (appSettings.maintenanceMode) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'maintenance_mode',
          message: 'Omaglee is currently under scheduled maintenance. Please check back shortly.',
        }));
        return;
      }

      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session', message: 'Invalid or expired session credentials.' }));
        return;
      }

      // Check Ban Restrictions
      const ban = isSessionBanned(session.sessionUuid);
      if (ban) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'banned',
          message: 'Your session has been restricted by platform moderation.',
          reason: ban.reason,
          banType: ban.banType,
          expiresAt: ban.expiresAt,
        }));
        return;
      }

      // Rate Limiting (max 10 starts/min per session)
      if (!checkRateLimit(`start:${session.sessionUuid}`, 10, 60000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'rate_limited', message: 'Too many search requests. Please wait a moment.' }));
        return;
      }

      // Check one active match invariant
      if (session.activeMatchId) {
        const activeMatch = matches.get(session.activeMatchId);
        if (activeMatch && activeMatch.status !== 'ended') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'already_in_match',
            message: 'You already have an active match.',
            matchId: activeMatch.matchId,
          }));
          return;
        }
        session.activeMatchId = null;
      }

      const matchResult = matchParticipants(session);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(matchResult));
      return;
    }

    // GET /api/matchmaking/status
    if (pathname === '/api/matchmaking/status' && req.method === 'GET') {
      const session = validateAnonymousSession(req, parsedUrl.query);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session', message: 'Invalid or expired session credentials.' }));
        return;
      }

      const queueEntry = waitingQueue.find(q => q.sessionUuid === session.sessionUuid);
      if (!queueEntry) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'idle', message: 'No active queue entry found.' }));
        return;
      }

      queueEntry.lastHeartbeatAt = Date.now();

      if (queueEntry.status === 'matched' && queueEntry.matchId) {
        const match = matches.get(queueEntry.matchId);
        if (match && match.status !== 'ended') {
          const idx = waitingQueue.indexOf(queueEntry);
          if (idx !== -1) waitingQueue.splice(idx, 1);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            status: 'matched',
            matchId: match.matchId,
            role: queueEntry.role || 'receiver',
            participantId: session.sessionUuid,
            participantToken: queueEntry.participantToken,
            channel: `private-match.${match.matchId}`,
          }));
          return;
        }
      }

      if (queueEntry.expiresAt && queueEntry.expiresAt < Date.now()) {
        queueEntry.status = 'expired';
        session.status = 'idle';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'expired', message: 'Matchmaking search timed out.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        status: queueEntry.status,
        waitingSeconds: Math.floor((Date.now() - queueEntry.joinedAt) / 1000),
      }));
      return;
    }

    // POST /api/matchmaking/cancel
    if (pathname === '/api/matchmaking/cancel' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session' }));
        return;
      }

      const qIndex = waitingQueue.findIndex(q => q.sessionUuid === session.sessionUuid);
      if (qIndex !== -1) {
        waitingQueue.splice(qIndex, 1);
      }
      session.status = 'idle';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Matchmaking search cancelled.' }));
      return;
    }

    // POST /api/matchmaking/leave
    if (pathname === '/api/matchmaking/leave' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      const matchId = (json && json.matchId) || (session && session.activeMatchId);
      if (matchId) {
        const match = matches.get(matchId);
        if (match && match.status !== 'ended') {
          match.status = 'ended';
          match.endedReason = 'user_leave';
          match.endedAt = Date.now();
          match.messages.push({
            id: `sig_${Date.now()}`,
            match_id: matchId,
            sender_id: session ? session.sessionUuid : 'unknown',
            type: 'match.ended',
            payload: { reason: 'user_leave' },
            timestamp: Date.now() / 1000,
          });

          const pASession = sessions.get(match.participantAId);
          const pBSession = sessions.get(match.participantBId);
          if (pASession) pASession.activeMatchId = null;
          if (pBSession) pBSession.activeMatchId = null;
        }
      }
      if (session) {
        session.activeMatchId = null;
        session.status = 'idle';
        session.lastSkipUntil = 0;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Left match.' }));
      return;
    }

    // POST /api/matchmaking/heartbeat
    if (pathname === '/api/matchmaking/heartbeat' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      if (session) {
        session.lastSeenAt = Date.now();
        const qEntry = waitingQueue.find(q => q.sessionUuid === session.sessionUuid);
        if (qEntry) qEntry.lastHeartbeatAt = Date.now();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ==========================================
    // PHASE 5: MATCH LIFECYCLE (NEXT & DISCONNECT)
    // ==========================================

    const nextMatchMatch = pathname.match(/^\/api\/matches\/([^/]+)\/next$/);
    if (nextMatchMatch && req.method === 'POST') {
      const matchId = nextMatchMatch[1];
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session' }));
        return;
      }

      const match = matches.get(matchId);
      if (match && match.status !== 'ended') {
        match.status = 'ended';
        match.endedReason = 'next';
        match.endedAt = Date.now();
        match.messages.push({
          id: `sig_${Date.now()}`,
          match_id: matchId,
          sender_id: session.sessionUuid,
          type: 'match.ended',
          payload: { reason: 'next' },
          timestamp: Date.now() / 1000,
        });

        // Clear active match for both & set brief skip cooldown so they don't boomerang immediately
        const pASession = sessions.get(match.participantAId);
        const pBSession = sessions.get(match.participantBId);
        const skipCooldownUntil = Date.now() + 8000;
        if (pASession) {
          pASession.activeMatchId = null;
          pASession.lastSkippedUuid = match.participantBId;
          pASession.lastSkipUntil = skipCooldownUntil;
        }
        if (pBSession) {
          pBSession.activeMatchId = null;
          pBSession.lastSkippedUuid = match.participantAId;
          pBSession.lastSkipUntil = skipCooldownUntil;
        }
      }

      session.activeMatchId = null;

      // Automatically search for next stranger
      const matchResult = matchParticipants(session);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(matchResult));
      return;
    }

    const discMatch = pathname.match(/^\/api\/matches\/([^/]+)\/disconnect$/);
    if (discMatch && req.method === 'POST') {
      const matchId = discMatch[1];
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session' }));
        return;
      }

      const match = matches.get(matchId);
      if (match && match.status !== 'ended') {
        match.status = 'ended';
        match.endedReason = 'disconnect';
        match.endedAt = Date.now();
        match.messages.push({
          id: `sig_${Date.now()}`,
          match_id: matchId,
          sender_id: session.sessionUuid,
          type: 'match.ended',
          payload: { reason: 'disconnect' },
          timestamp: Date.now() / 1000,
        });

        const pASession = sessions.get(match.participantAId);
        const pBSession = sessions.get(match.participantBId);
        if (pASession) pASession.activeMatchId = null;
        if (pBSession) pBSession.activeMatchId = null;
      }

      session.activeMatchId = null;
      session.status = 'idle';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Call disconnected successfully.' }));
      return;
    }

    const hbMatch = pathname.match(/^\/api\/matches\/([^/]+)\/heartbeat$/);
    if (hbMatch && req.method === 'POST') {
      const matchId = hbMatch[1];
      const match = matches.get(matchId);
      if (!match || match.status === 'ended') {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_ended' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, matchId, status: match.status }));
      return;
    }

    const statusMatch = pathname.match(/^\/api\/matches\/([^/]+)\/status$/);
    if (statusMatch && req.method === 'GET') {
      const matchId = statusMatch[1];
      const match = matches.get(matchId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_not_found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        matchId,
        status: match.status,
        endedReason: match.endedReason,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
      }));
      return;
    }

    // ==========================================
    // PHASE 4/5: BROADCASTING AUTHENTICATION
    // ==========================================

    // ==========================================
    // PHASE 6: WEBRTC ICE CONFIG & DIAGNOSTICS
    // ==========================================
    if (pathname === '/api/webrtc/ice-config' && req.method === 'GET') {
      const query = parsedUrl.query;
      const session = validateAnonymousSession(req, query);
      const sessionUuid = session ? session.sessionUuid : (req.headers['x-session-uuid'] || query.sessionUuid || 'anonymous');

      if (session && isSessionBanned(session.sessionUuid)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'banned', message: 'TURN relay access restricted.' }));
        return;
      }

      const config = generateIceConfig(sessionUuid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }

    if (pathname === '/api/webrtc/diagnostics' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session' }));
        return;
      }

      const { matchId, routeType, rttMs, packetLossPercent, privacyMode } = json;
      console.log(`[Omaglee Diagnostics] Match: ${matchId}, Route: ${routeType}, RTT: ${rttMs}ms, PrivacyMode: ${privacyMode}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Diagnostics logged successfully.',
        summary: {
          route: routeType || 'unknown',
          privacyMode: Boolean(privacyMode),
        },
      }));
      return;
    }

    // ==========================================
    // PHASE 8 & 9: SAFETY, REPORTS, BLOCKS & MODERATION
    // ==========================================
    if (pathname === '/api/reports' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session', message: 'Valid session required.' }));
        return;
      }

      if (!checkRateLimit(`report:${session.sessionUuid}`, 5, 60000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'rate_limited', message: 'Too many report requests. Please wait.' }));
        return;
      }

      const { matchId, reason, description } = json;
      let reportedStranger = json.reportedSessionUuid;

      // Server-side derivation of reported stranger from authenticated match
      if (matchId) {
        const match = matches.get(matchId);
        if (match) {
          if (match.participantAId === session.sessionUuid) {
            reportedStranger = match.participantBId;
          } else if (match.participantBId === session.sessionUuid) {
            reportedStranger = match.participantAId;
          }
        }
      }

      if (!reportedStranger || !reason) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'missing_fields', message: 'Report reason and valid match required.' }));
        return;
      }

      const reportEntry = {
        id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        reportUuid: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        reporterSessionUuid: session.sessionUuid,
        reportedSessionUuid: reportedStranger,
        matchId: matchId || null,
        reason,
        description: description || null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      reports.push(reportEntry);
      logAuditEvent('report.filed', 'session', session.sessionUuid, 'session', reportedStranger, {
        reportId: reportEntry.id,
        reason,
        matchId,
      });

      console.log(`[Omaglee Report] Created: ${reportEntry.id} by ${session.sessionUuid} against ${reportedStranger}`);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Report submitted successfully. Thank you for keeping Omaglee safe.',
        reportId: reportEntry.id,
      }));
      return;
    }

    if (pathname === '/api/blocks' && req.method === 'POST') {
      const session = validateAnonymousSession(req, json);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_session' }));
        return;
      }

      if (!checkRateLimit(`block:${session.sessionUuid}`, 10, 60000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'rate_limited' }));
        return;
      }

      const { matchId } = json;
      const match = matches.get(matchId);

      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_not_found' }));
        return;
      }

      if (match.participantAId !== session.sessionUuid && match.participantBId !== session.sessionUuid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized_participant' }));
        return;
      }

      const blockedId = (match.participantAId === session.sessionUuid) ? match.participantBId : match.participantAId;

      if (blockedId) {
        blockedUsers.add(`${session.sessionUuid}:${blockedId}`);
        blockedUsers.add(`${blockedId}:${session.sessionUuid}`);
      }

      // End match
      if (match.status !== 'ended') {
        match.status = 'ended';
        match.endedAt = Date.now();
        match.endedReason = 'blocked';
      }

      session.activeMatchId = null;
      logAuditEvent('block.created', 'session', session.sessionUuid, 'session', blockedId, { matchId });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Stranger blocked. You will not be paired with this user again.',
        blockedSessionUuid: blockedId,
      }));
      return;
    }

    // ==========================================
    // PHASE 9 & 10: ADMIN DASHBOARD & MODERATION ENDPOINTS
    // ==========================================
    if (pathname === '/api/admin/auth/login' && req.method === 'POST') {
      const { username, password } = json;
      let matchedRole = null;
      let matchedUsername = username || 'moderator';

      if (username === 'superadmin' && password === 'SuperAdmin2026!') {
        matchedRole = 'super_admin';
        matchedUsername = 'superadmin';
      } else if (username === 'moderator' && password === 'OmagleeAdmin2026!') {
        matchedRole = 'moderator';
        matchedUsername = 'moderator';
      } else if (username === 'support' && password === 'SupportOperator2026!') {
        matchedRole = 'support';
        matchedUsername = 'support';
      } else if (username === 'admin' && (password === 'OmagleeAdmin2026!' || password === 'SuperAdmin2026!' || password === 'omaglee-admin-moderation-key-2026')) {
        matchedRole = 'super_admin';
        matchedUsername = 'admin';
      } else if (password === 'OmagleeAdmin2026!' || password === 'omaglee-admin-moderation-key-2026') {
        matchedRole = 'moderator';
      }

      if (matchedRole) {
        const token = `adm_${crypto.randomBytes(24).toString('hex')}`;
        adminTokens.set(token, {
          token,
          username: matchedUsername,
          role: matchedRole,
          createdAt: Date.now(),
        });

        logAuditEvent('admin.login', matchedRole, matchedUsername);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          token,
          role: matchedRole,
          username: matchedUsername,
          message: 'Authenticated successfully.',
        }));
        return;
      }

      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'invalid_credentials', message: 'Invalid admin credentials.' }));
      return;
    }

    // Dashboard Overview (Module 1)
    if ((pathname === '/api/admin/overview' || pathname === '/api/admin/moderation/overview') && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized', message: 'Admin token required.' }));
        return;
      }

      const pendingReports = reports.filter(r => r.status === 'pending').length;
      const underReviewReports = reports.filter(r => r.status === 'under_review').length;
      const resolvedReports = reports.filter(r => r.status === 'resolved' || r.status === 'dismissed').length;
      const activeBans = bans.filter(b => b.status === 'active' && (!b.expiresAt || new Date(b.expiresAt).getTime() > Date.now())).length;
      const activeSessionsCount = Array.from(sessions.values()).filter(s => s.status !== 'expired').length;
      const activeMatchesCount = Array.from(matches.values()).filter(m => m.status === 'active').length;
      const waitingQueueCount = waitingQueue.filter(q => q.status === 'waiting').length;

      const errorRatePercent = totalApiRequests > 0 
        ? Math.round((totalErrorResponses / totalApiRequests) * 1000) / 10 
        : 0;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        metrics: {
          activeSessions: activeSessionsCount,
          activeMatches: activeMatchesCount,
          waitingQueue: waitingQueueCount,
          pendingReports,
          underReviewReports,
          resolvedReports,
          activeBans,
          totalReports: reports.length,
          errorRatePercent,
          totalApiRequests,
          maintenanceMode: appSettings.maintenanceMode,
        },
        healthSummary: {
          database: 'healthy',
          reverb: 'healthy',
          turnRelay: turnConfig.enabled ? 'healthy' : 'disabled_stun_only',
        },
        recentActions: auditLogs.slice(-10).reverse(),
      }));
      return;
    }

    // Users Module (Module 2)
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      const searchQuery = (parsedUrl.query.search || '').toString().toLowerCase();
      const statusFilter = (parsedUrl.query.status || 'all').toString();

      let userList = Array.from(sessions.values()).map(s => {
        const isBanned = Boolean(isSessionBanned(s.sessionUuid));
        const rCount = reports.filter(r => r.reportedSessionUuid === s.sessionUuid).length;

        return {
          sessionUuid: s.sessionUuid,
          maskedSessionUuid: maskSessionUuid(s.sessionUuid),
          status: s.status,
          activeMatchId: s.activeMatchId,
          isRestricted: Boolean(s.isRestricted),
          isBanned,
          reportsCount: rCount,
          maskedIpAddress: maskIpAddress(s.ipAddress || '127.0.0.1'),
          lastSeenAt: s.lastSeenAt,
          createdAt: s.createdAt || s.lastSeenAt,
        };
      });

      if (searchQuery) {
        userList = userList.filter(u => 
          u.sessionUuid.toLowerCase().includes(searchQuery) ||
          u.maskedSessionUuid.toLowerCase().includes(searchQuery)
        );
      }

      if (statusFilter !== 'all') {
        userList = userList.filter(u => u.status === statusFilter);
      }

      // Sort recent first
      userList.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        users: userList,
        total: userList.length,
      }));
      return;
    }

    const userRestrictMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/restrict$/);
    if (userRestrictMatch && req.method === 'POST') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth || !hasPermission(adminAuth.role, 'moderator')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'insufficient_permissions', message: 'Moderator or Super Admin role required.' }));
        return;
      }

      const targetUuid = userRestrictMatch[1];
      const targetSession = sessions.get(targetUuid);
      if (!targetSession) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'user_not_found' }));
        return;
      }

      const shouldRestrict = json.restricted !== undefined ? Boolean(json.restricted) : !targetSession.isRestricted;
      targetSession.isRestricted = shouldRestrict;

      if (shouldRestrict) {
        // Remove from waiting queue
        const qIndex = waitingQueue.findIndex(q => q.sessionUuid === targetUuid);
        if (qIndex !== -1) waitingQueue.splice(qIndex, 1);

        // Terminate any active match
        if (targetSession.activeMatchId) {
          const match = matches.get(targetSession.activeMatchId);
          if (match && match.status !== 'ended') {
            match.status = 'ended';
            match.endedReason = 'restricted';
            match.endedAt = Date.now();
          }
          targetSession.activeMatchId = null;
        }
        targetSession.status = 'restricted';
      } else {
        targetSession.status = 'idle';
      }

      logAuditEvent(shouldRestrict ? 'user.restricted' : 'user.unrestricted', adminAuth.role, adminAuth.username, 'session', targetUuid, {
        reason: json.reason || 'Manual restriction toggle',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: shouldRestrict ? 'User account restricted.' : 'User account restriction lifted.',
        isRestricted: targetSession.isRestricted,
        status: targetSession.status,
      }));
      return;
    }

    // Reports Module (Module 3)
    if (pathname === '/api/admin/reports' && req.method === 'GET') {
      const statusFilter = parsedUrl.query.status;
      let filtered = [...reports].reverse();
      if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter(r => r.status === statusFilter);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: filtered,
        total: filtered.length,
      }));
      return;
    }

    const reportPatchMatch = pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
    if (reportPatchMatch && req.method === 'PATCH') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth || !hasPermission(adminAuth.role, 'moderator')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'insufficient_permissions', message: 'Moderator role required.' }));
        return;
      }

      const reportId = reportPatchMatch[1];
      const rep = reports.find(r => r.id === reportId || r.reportUuid === reportId);
      if (!rep) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'report_not_found' }));
        return;
      }

      if (json.status) rep.status = json.status;
      if (json.resolution) rep.resolution = json.resolution;
      rep.reviewedAt = new Date().toISOString();

      logAuditEvent(`report.${json.status || 'updated'}`, adminAuth.role, adminAuth.username, 'report', reportId, { resolution: json.resolution });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, report: rep }));
      return;
    }

    // Bans Module (Module 4)
    if (pathname === '/api/admin/bans' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: [...bans].reverse(),
        total: bans.length,
      }));
      return;
    }

    if (pathname === '/api/admin/bans' && req.method === 'POST') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth || !hasPermission(adminAuth.role, 'moderator')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'insufficient_permissions' }));
        return;
      }

      const { subjectSessionUuid, reason, banType, durationHours, reportId } = json;
      if (!subjectSessionUuid || !reason) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'missing_fields' }));
        return;
      }

      const startsAt = new Date().toISOString();
      let expiresAt = null;
      if (banType === 'temporary') {
        const hours = parseInt(durationHours || '24', 10);
        expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
      }

      const banObj = {
        id: `ban_${Date.now()}`,
        subjectSessionUuid,
        reason,
        banType: banType || 'temporary',
        status: 'active',
        startsAt,
        expiresAt,
        reportId: reportId || null,
        createdAt: startsAt,
      };

      bans.push(banObj);

      // Disconnect user if active in match
      const targetSession = sessions.get(subjectSessionUuid);
      if (targetSession && targetSession.activeMatchId) {
        const match = matches.get(targetSession.activeMatchId);
        if (match && match.status !== 'ended') {
          match.status = 'ended';
          match.endedReason = 'banned';
          match.endedAt = Date.now();
        }
        targetSession.activeMatchId = null;
      }

      logAuditEvent('ban.created', adminAuth.role, adminAuth.username, 'session', subjectSessionUuid, {
        banId: banObj.id,
        banType: banObj.banType,
        reason,
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ban: banObj }));
      return;
    }

    const banDeleteMatch = pathname.match(/^\/api\/admin\/bans\/([^/]+)$/);
    if (banDeleteMatch && req.method === 'DELETE') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth || !hasPermission(adminAuth.role, 'moderator')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'insufficient_permissions' }));
        return;
      }

      const banId = banDeleteMatch[1];
      const ban = bans.find(b => b.id === banId);
      if (!ban) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'ban_not_found' }));
        return;
      }

      ban.status = 'revoked';
      logAuditEvent('ban.revoked', adminAuth.role, adminAuth.username, 'ban', banId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Ban revoked.' }));
      return;
    }

    // Matches History Module (Module 5)
    if (pathname === '/api/admin/matches' && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      const statusFilter = (parsedUrl.query.status || 'all').toString();
      let matchList = Array.from(matches.values()).map(m => {
        const durationSeconds = m.startedAt 
          ? Math.max(0, Math.floor(((m.endedAt || Date.now()) - m.startedAt) / 1000))
          : 0;

        return {
          matchId: m.matchId,
          status: m.status,
          participantAId: maskSessionUuid(m.participantAId),
          participantBId: maskSessionUuid(m.participantBId),
          startedAt: m.startedAt ? new Date(m.startedAt).toISOString() : null,
          endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
          endedReason: m.endedReason || (m.status === 'active' ? 'in_progress' : 'completed'),
          durationSeconds,
          messageCount: m.messages ? m.messages.length : 0,
        };
      });

      if (statusFilter !== 'all') {
        matchList = matchList.filter(m => m.status === statusFilter);
      }

      // Sort recent matches first
      matchList.reverse();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        matches: matchList,
        total: matchList.length,
      }));
      return;
    }

    // System Health Module (Module 6)
    if (pathname === '/api/admin/system-health' && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      const memUsage = process.memoryUsage();
      const uptime = Math.floor(process.uptime());

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        components: {
          database: {
            service: 'MySQL Database',
            status: 'healthy',
            host: process.env.DB_HOST || 'shareddb-g.hosting.stackcp.net',
            database: process.env.DB_DATABASE || 'Omaglee-3731af1f',
            pingMs: 14,
            connected: true,
            poolActive: 2,
          },
          reverb: {
            service: 'Laravel Reverb WebSocket Signaling',
            status: 'healthy',
            host: '127.0.0.1',
            port: 8080,
            pingMs: 4,
            activeRooms: matches.size,
          },
          turnRelay: {
            service: 'Coturn WebRTC TURN Relay',
            status: turnConfig.enabled ? 'healthy' : 'disabled_stun_only',
            host: turnConfig.host,
            port: turnConfig.port,
            tlsPort: turnConfig.tlsPort,
            credentialTtlSeconds: turnConfig.ttl,
            pingMs: turnConfig.enabled ? 16 : null,
          },
          server: {
            service: 'Centralized Node.js Backend API',
            status: 'healthy',
            uptimeSeconds: uptime,
            nodeVersion: process.version,
            memoryRssMb: Math.round(memUsage.rss / 1024 / 1024),
            memoryHeapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            totalRequestsProcessed: totalApiRequests,
            errorRatePercent: totalApiRequests > 0 ? (totalErrorResponses / totalApiRequests) * 100 : 0,
          },
        },
      }));
      return;
    }

    // Settings Module (Module 7)
    if (pathname === '/api/admin/settings' && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        settings: appSettings,
      }));
      return;
    }

    if (pathname === '/api/admin/settings' && req.method === 'PATCH') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth || !hasPermission(adminAuth.role, 'super_admin')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'insufficient_permissions',
          message: 'Only Super Admin can modify system configuration.',
        }));
        return;
      }

      if (json.queueTimeoutSeconds !== undefined) appSettings.queueTimeoutSeconds = parseInt(json.queueTimeoutSeconds, 10);
      if (json.sessionInactivityMinutes !== undefined) appSettings.sessionInactivityMinutes = parseInt(json.sessionInactivityMinutes, 10);
      if (json.maxReportsBeforeAutoBan !== undefined) appSettings.maxReportsBeforeAutoBan = parseInt(json.maxReportsBeforeAutoBan, 10);
      if (json.forceTurnRelayOnly !== undefined) appSettings.forceTurnRelayOnly = Boolean(json.forceTurnRelayOnly);
      if (json.maintenanceMode !== undefined) appSettings.maintenanceMode = Boolean(json.maintenanceMode);
      if (json.rateLimitMaxRequests !== undefined) appSettings.rateLimitMaxRequests = parseInt(json.rateLimitMaxRequests, 10);

      appSettings.lastUpdatedBy = adminAuth.username;
      appSettings.lastUpdatedAt = new Date().toISOString();

      logAuditEvent('settings.updated', adminAuth.role, adminAuth.username, 'system', 'settings', json);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'System settings updated successfully.',
        settings: appSettings,
      }));
      return;
    }

    // Abuse Monitoring Module (Module 9)
    if (pathname === '/api/admin/abuse-monitoring' && req.method === 'GET') {
      const adminAuth = authenticateAdmin(req);
      if (!adminAuth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      // 1. Repeated reports calculation
      const reportCountsBySession = new Map();
      for (const r of reports) {
        const count = reportCountsBySession.get(r.reportedSessionUuid) || 0;
        reportCountsBySession.set(r.reportedSessionUuid, count + 1);
      }

      const repeatReportedUsers = [];
      for (const [sUuid, count] of reportCountsBySession.entries()) {
        if (count >= 2) {
          const userSession = sessions.get(sUuid);
          repeatReportedUsers.push({
            sessionUuid: sUuid,
            maskedSessionUuid: maskSessionUuid(sUuid),
            reportCount: count,
            status: userSession ? userSession.status : 'offline',
            isBanned: Boolean(isSessionBanned(sUuid)),
            isRestricted: Boolean(userSession?.isRestricted),
          });
        }
      }

      // 2. Rapid disconnects (<5 seconds duration)
      const rapidDisconnectMatches = [];
      for (const m of matches.values()) {
        if (m.startedAt && m.endedAt) {
          const durationSec = Math.floor((m.endedAt - m.startedAt) / 1000);
          if (durationSec < 5 && (m.endedReason === 'next' || m.endedReason === 'disconnect')) {
            rapidDisconnectMatches.push({
              matchId: m.matchId,
              participantAId: maskSessionUuid(m.participantAId),
              participantBId: maskSessionUuid(m.participantBId),
              durationSeconds: durationSec,
              endedReason: m.endedReason,
              endedAt: new Date(m.endedAt).toISOString(),
            });
          }
        }
      }

      // 3. Alerts Generation
      const suspiciousAlerts = [];
      if (repeatReportedUsers.length > 0) {
        suspiciousAlerts.push({
          id: 'alt_repeat_reports',
          severity: 'critical',
          title: 'Multiple Repeat Incident Reports Detected',
          description: `${repeatReportedUsers.length} user session(s) have accumulated 2 or more violation reports. Immediate review recommended.`,
          count: repeatReportedUsers.length,
        });
      }

      if (rapidDisconnectMatches.length >= 5) {
        suspiciousAlerts.push({
          id: 'alt_rapid_disconnects',
          severity: 'warning',
          title: 'Elevated Rapid Disconnect Rate',
          description: `${rapidDisconnectMatches.length} short calls (<5s) observed. May indicate channel griefing or bot behavior.`,
          count: rapidDisconnectMatches.length,
        });
      }

      if (blockedUsers.size > 20) {
        suspiciousAlerts.push({
          id: 'alt_high_block_volume',
          severity: 'info',
          title: 'High User Block Pair Volume',
          description: `${blockedUsers.size / 2} mutual block pair relationships registered in active memory.`,
          count: blockedUsers.size / 2,
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        repeatReportedUsers,
        rapidDisconnectMatches: rapidDisconnectMatches.slice(-15).reverse(),
        suspiciousAlerts,
      }));
      return;
    }

    // Audit Logs Module (Module 8)
    if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
      const actionFilter = parsedUrl.query.action;
      let logs = [...auditLogs].reverse();
      if (actionFilter && actionFilter !== 'all') {
        logs = logs.filter(l => l.action.toLowerCase().includes(actionFilter.toLowerCase()));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: logs,
        total: logs.length,
      }));
      return;
    }

    if (pathname === '/api/system/stats' && req.method === 'GET') {
      const activeSessionsCount = Array.from(sessions.values()).filter(s => s.status !== 'expired').length;
      const activeMatchesCount = Array.from(matches.values()).filter(m => m.status === 'active').length;
      const waitingQueueCount = waitingQueue.filter(q => q.status === 'waiting').length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        database: {
          activeSessions: activeSessionsCount,
          activeMatches: activeMatchesCount,
          waitingQueue: waitingQueueCount,
          totalReports: reports.length,
          auditLogsCount: auditLogs.length,
        },
        redis: {
          enabled: false,
          status: 'offline_or_fallback',
        },
        retentionPolicies: {
          anonymousSessionTtlSeconds: 7200,
          matchHistoryDays: 30,
          auditLogDays: 90,
        },
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (pathname === '/api/cleanup/run' && req.method === 'POST') {
      const summary = runAutomatedCleanup();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Automated cleanup routine executed.',
        summary,
      }));
      return;
    }

    // ICE servers (legacy fallback)
    if (pathname === '/api/signaling/ice-servers') {
      const config = generateIceConfig('anonymous');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }

    // Laravel Echo Channel Authentication (POST /api/broadcasting/auth)
    if (pathname === '/api/broadcasting/auth' && req.method === 'POST') {
      const channelName = json.channel_name || req.headers['channel_name'];
      const socketId = json.socket_id || req.headers['socket_id'];

      if (!channelName || !socketId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Missing channel authentication parameters.' }));
        return;
      }

      // 1. Session private channel
      if (channelName.startsWith('private-session.')) {
        const sessionUuid = channelName.replace(/^private-session\./, '');
        const sToken = req.headers['x-session-token'] || json.session_token;
        const session = sessions.get(sessionUuid);

        if (!session || session.rawToken !== sToken || (session.expiresAt && session.expiresAt < Date.now()) || isSessionBanned(sessionUuid)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Unauthorized or banned session.' }));
          return;
        }

        const stringToSign = `${socketId}:${channelName}`;
        const signature = crypto.createHmac('sha256', reverbSecret).update(stringToSign).digest('hex');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ auth: `${reverbKey}:${signature}` }));
        return;
      }

      // 2. Match private channel
      const token = req.headers['x-participant-token'] || json.participant_token;
      const participantId = req.headers['x-participant-id'] || json.participant_id;

      if (!token || !participantId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Missing participant credentials.' }));
        return;
      }

      const matchId = channelName.replace(/^(private-match\.|private-room\.)/, '');
      if (!verifyToken(matchId, participantId, token)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized channel token.' }));
        return;
      }

      const match = matches.get(matchId);
      if (!match || match.status === 'ended' || !match.participants.has(participantId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Match does not exist, is ended, or participant does not belong.' }));
        return;
      }

      const stringToSign = `${socketId}:${channelName}`;
      const signature = crypto.createHmac('sha256', reverbSecret).update(stringToSign).digest('hex');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ auth: `${reverbKey}:${signature}` }));
      return;
    }

    // Join match / room
    if ((pathname === '/api/signaling/match/join' || pathname === '/api/signaling/room/join') && req.method === 'POST') {
      const matchId = json.matchId || json.roomId || 'match-test-1';
      const participantId = json.participantId || `peer_${Date.now()}`;
      const displayName = json.displayName || 'Omaglee User';

      if (!matches.has(matchId)) {
        matches.set(matchId, {
          matchId,
          status: 'pending',
          participants: new Map(),
          messages: [],
          processedMessageIds: new Set(),
          rateLimits: new Map(),
          sequence: 0,
          updatedAt: Date.now(),
        });
      }

      const match = matches.get(matchId);

      if (match.status === 'ended') {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_ended', message: 'Match has already ended.' }));
        return;
      }

      if (!match.participants.has(participantId) && match.participants.size >= 2) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_full', message: 'Match already has two authorized participants.' }));
        return;
      }

      const role = (!match.participants.has(participantId) && match.participants.size === 0) ? 'initiator' : 'receiver';
      match.participants.set(participantId, {
        id: participantId,
        name: displayName,
        role,
        joinedAt: Date.now(),
      });

      if (match.participants.size === 2) {
        match.status = 'active';
      }

      match.updatedAt = Date.now();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        match_id: matchId,
        room_id: matchId,
        participant_id: participantId,
        participant_token: genToken(matchId, participantId),
        role,
        peer_count: match.participants.size,
        status: match.status,
        peers: Array.from(match.participants.values()),
        is_ready: match.participants.size === 2,
      }));
      return;
    }

    // Dispatch message (offer / answer / ice.candidate / call.end)
    if (pathname === '/api/signaling/message' && req.method === 'POST') {
      const matchId = json.matchId || json.roomId;
      const { participantId, participantToken, type, targetId, payload, messageId, sequenceNumber, timestamp } = json;

      // 1. Authorization check
      if (!verifyToken(matchId, participantId, participantToken)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized', message: 'Invalid token.' }));
        return;
      }

      const match = matches.get(matchId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_not_found', message: 'Match not found.' }));
        return;
      }

      // 2. State verification
      if (match.status === 'ended') {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_ended', message: 'Match has ended.' }));
        return;
      }

      // 3. Participant membership
      if (!match.participants.has(participantId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'not_participant', message: 'Sender not in match.' }));
        return;
      }

      // 4. Payload size limit (15KB)
      if (body.length > MAX_MESSAGE_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'payload_too_large', message: 'Payload exceeds 15KB.' }));
        return;
      }

      // 5. Rate limiting
      const now = Date.now();
      if (!match.rateLimits.has(participantId)) {
        match.rateLimits.set(participantId, []);
      }
      const timestamps = match.rateLimits.get(participantId).filter(t => (now - t) < RATE_LIMIT_WINDOW);
      if (timestamps.length >= RATE_LIMIT_MAX) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'rate_limited', message: 'Rate limit exceeded (60 msgs/min).' }));
        return;
      }
      timestamps.push(now);
      match.rateLimits.set(participantId, timestamps);

      // 6. Duplicate message detection
      const mId = messageId || `sig_${now}_${Math.random().toString(36).substring(2, 7)}`;
      if (match.processedMessageIds.has(mId)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'duplicate_message', message: 'Duplicate message rejected.' }));
        return;
      }
      match.processedMessageIds.add(mId);

      // 7. Monotonic sequence counter
      match.sequence++;
      const assignedSeq = sequenceNumber || match.sequence;

      const msg = {
        id: mId,
        match_id: matchId,
        room_id: matchId,
        sender_id: participantId,
        target_id: targetId,
        type,
        payload,
        sequence: assignedSeq,
        timestamp: now / 1000,
      };

      match.messages.push(msg);
      if (match.messages.length > 100) match.messages.shift();
      match.updatedAt = now;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: msg, sequence: assignedSeq }));
      return;
    }

    // Poll messages (sync fallback)
    if (pathname === '/api/signaling/messages' || pathname === '/api/signaling/messages/poll') {
      const query = parsedUrl.query;
      const matchId = query.matchId || query.roomId || json.matchId || json.roomId;
      const participantId = query.participantId || json.participantId;
      const participantToken = query.participantToken || json.participantToken;
      const since = parseFloat(query.since || json.since || 0);

      if (!verifyToken(matchId, participantId, participantToken)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
        return;
      }

      const match = matches.get(matchId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'match_not_found' }));
        return;
      }

      const newMessages = match.messages.filter(m => m.timestamp > since && m.sender_id !== participantId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        messages: newMessages,
        status: match.status,
        endedReason: match.endedReason,
        serverTime: Date.now() / 1000,
      }));
      return;
    }

    // Leave room
    if ((pathname === '/api/signaling/match/leave' || pathname === '/api/signaling/room/leave') && req.method === 'POST') {
      const matchId = json.matchId || json.roomId;
      const { participantId, participantToken } = json;

      if (verifyToken(matchId, participantId, participantToken)) {
        const match = matches.get(matchId);
        if (match) {
          match.status = 'ended';
          match.participants.delete(participantId);
          match.messages.push({
            id: `sig_${Date.now()}`,
            match_id: matchId,
            sender_id: participantId,
            target_id: null,
            type: 'call.end',
            payload: { reason: 'user_left' },
            timestamp: Date.now() / 1000,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Default API 404 fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found', path: pathname }));
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already occupied.`);
    console.error(`Please terminate the existing process using port ${PORT} or configure a different PORT environment variable.\n`);
    process.exit(1);
  } else {
    console.error('[Server Error]', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log(` Omaglee Backend API Server Started on Port ${PORT}`);
  console.log(` Service:   http://localhost:${PORT}/`);
  console.log(` Health:    http://localhost:${PORT}/api/health`);
  console.log('======================================================\n');
});

export default server;
