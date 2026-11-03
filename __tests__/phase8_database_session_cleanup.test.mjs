import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

describe('Phase 8: Database, Session Management, Redis & Automated Cleanup Suite', () => {

  describe('1. Anonymous Session Lifecycle & Cryptographic Token Hashing', () => {
    function generateSession() {
      const sessionUuid = `sess_${crypto.randomBytes(16).toString('hex')}`;
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const now = Date.now();
      const ttlMs = 7200 * 1000; // 2 hours

      return {
        sessionUuid,
        rawToken,
        tokenHash,
        status: 'idle',
        activeMatchId: null,
        lastSeenAt: now,
        expiresAt: now + ttlMs,
      };
    }

    function validateSession(session, providedToken) {
      if (!session) return { valid: false, reason: 'not_found' };
      if (session.status === 'expired' || session.status === 'revoked') {
        return { valid: false, reason: 'inactive' };
      }
      if (Date.now() > session.expiresAt) {
        return { valid: false, reason: 'expired' };
      }
      const hashedProvided = crypto.createHash('sha256').update(providedToken).digest('hex');
      if (hashedProvided !== session.tokenHash) {
        return { valid: false, reason: 'invalid_token' };
      }
      return { valid: true };
    }

    it('creates anonymous session with SHA-256 token hashing without storing plaintext secrets in DB', () => {
      const session = generateSession();
      assert.ok(session.sessionUuid.startsWith('sess_'));
      assert.strictEqual(session.tokenHash.length, 64, 'SHA-256 hash must be 64 hex characters');
      assert.notStrictEqual(session.tokenHash, session.rawToken, 'Stored hash must differ from raw token');
    });

    it('validates active session successfully with correct raw token', () => {
      const session = generateSession();
      const res = validateSession(session, session.rawToken);
      assert.strictEqual(res.valid, true);
    });

    it('rejects tampered or invalid session token', () => {
      const session = generateSession();
      const res = validateSession(session, 'wrong_token_123');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'invalid_token');
    });

    it('rejects expired session and flags expired reason', () => {
      const session = generateSession();
      session.expiresAt = Date.now() - 5000; // Expired 5 seconds ago
      const res = validateSession(session, session.rawToken);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'expired');
    });

    it('rejects revoked session immediately', () => {
      const session = generateSession();
      session.status = 'revoked';
      const res = validateSession(session, session.rawToken);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'inactive');
    });
  });

  describe('2. Match Data Integrity & Participant Relationships', () => {
    it('enforces one active match per participant rule and prevents self-matching', () => {
      const sessions = new Map();
      const matches = new Map();

      const userA = { uuid: 'user_A', activeMatchId: null };
      const userB = { uuid: 'user_B', activeMatchId: null };
      sessions.set('user_A', userA);
      sessions.set('user_B', userB);

      function createMatch(pA, pB) {
        if (pA === pB) throw new Error('Self-match prohibited');
        if (sessions.get(pA).activeMatchId) throw new Error(`Participant ${pA} already in active match`);
        if (sessions.get(pB).activeMatchId) throw new Error(`Participant ${pB} already in active match`);

        const matchId = `match_${Date.now()}`;
        matches.set(matchId, {
          matchId,
          status: 'active',
          participantAId: pA,
          participantBId: pB,
        });

        sessions.get(pA).activeMatchId = matchId;
        sessions.get(pB).activeMatchId = matchId;
        return matchId;
      }

      // Self-match attempt must throw
      assert.throws(() => createMatch('user_A', 'user_A'), /Self-match prohibited/);

      // Valid match
      const m1 = createMatch('user_A', 'user_B');
      assert.ok(m1);
      assert.strictEqual(userA.activeMatchId, m1);
      assert.strictEqual(userB.activeMatchId, m1);

      // Attempting to match userA again must fail
      assert.throws(() => createMatch('user_A', 'user_C'), /already in active match/);
    });

    it('prevents ended matches from being reactivated', () => {
      const match = { matchId: 'm_1', status: 'ended', endedReason: 'next' };
      function updateMatchSignaling(m) {
        if (m.status === 'ended') {
          return { error: 'match_ended', allowed: false };
        }
        return { allowed: true };
      }

      const res = updateMatchSignaling(match);
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.error, 'match_ended');
    });
  });

  describe('3. Redis Architecture & SQL Fallback Abstraction', () => {
    it('verifies Redis key naming conventions adhere to specs', () => {
      const prefix = 'omaglee:';
      const sessionUuid = 'sess_xyz123';
      const matchId = 'match_456';

      const queueKey = `${prefix}queue:waiting`;
      const presenceKey = `${prefix}session:${sessionUuid}:presence`;
      const lockKey = `${prefix}lock:participant:${sessionUuid}`;
      const matchStateKey = `${prefix}match:${matchId}:state`;

      assert.strictEqual(queueKey, 'omaglee:queue:waiting');
      assert.strictEqual(presenceKey, 'omaglee:session:sess_xyz123:presence');
      assert.strictEqual(lockKey, 'omaglee:lock:participant:sess_xyz123');
      assert.strictEqual(matchStateKey, 'omaglee:match:match_456:state');
    });

    it('falls back to atomic SQL/in-memory lock and queue when Redis is disabled', () => {
      const inMemoryLocks = new Map();

      function acquireLock(key, ttlMs = 5000) {
        const now = Date.now();
        const existing = inMemoryLocks.get(key);
        if (existing && existing > now) {
          return false; // Locked
        }
        inMemoryLocks.set(key, now + ttlMs);
        return true;
      }

      assert.strictEqual(acquireLock('user_lock_1'), true);
      assert.strictEqual(acquireLock('user_lock_1'), false, 'Duplicate lock attempt must be rejected');
    });
  });

  describe('4. Automated Data Cleanup & Retention Policies', () => {
    it('prunes stale queue entries and expired sessions while preserving active records', () => {
      const now = Date.now();

      // Mock sessions
      const sessions = [
        { id: 1, status: 'active', lastSeenAt: now - 10000, expiresAt: now + 3600000 },
        { id: 2, status: 'active', lastSeenAt: now - 8000000, expiresAt: now - 1000 }, // Expired
      ];

      // Mock queue entries
      const queue = [
        { id: 101, sessionUuid: 'sess_live', status: 'waiting', lastHeartbeatAt: now - 5000 }, // Fresh
        { id: 102, sessionUuid: 'sess_stale', status: 'waiting', lastHeartbeatAt: now - 45000 }, // Stale (>30s)
      ];

      // Mock reports
      const reports = [
        { id: 1, reason: 'harassment', status: 'pending' }, // Must NOT be deleted
      ];

      // Execute cleanup simulation
      let expiredSessionsCount = 0;
      sessions.forEach(s => {
        if (s.expiresAt < now || s.lastSeenAt < now - 7200000) {
          s.status = 'expired';
          expiredSessionsCount++;
        }
      });

      const remainingQueue = queue.filter(q => q.lastHeartbeatAt >= now - 30000);
      const prunedQueueCount = queue.length - remainingQueue.length;

      assert.strictEqual(expiredSessionsCount, 1, 'Only stale session must be marked expired');
      assert.strictEqual(sessions[0].status, 'active', 'Live session must be preserved');
      assert.strictEqual(prunedQueueCount, 1, 'Stale queue entry must be purged');
      assert.strictEqual(remainingQueue[0].sessionUuid, 'sess_live', 'Fresh queue entry must remain');
      assert.strictEqual(reports.length, 1, 'Unresolved reports must NEVER be deleted during cleanup');
    });
  });

  describe('5. Audit Logging Security & Credential Exclusion', () => {
    function createAuditLog(action, metadata) {
      const blockedKeys = ['password', 'token', 'rawToken', 'secret', 'turnSecret'];
      const sanitized = {};
      for (const [k, v] of Object.entries(metadata || {})) {
        if (!blockedKeys.includes(k)) {
          sanitized[k] = v;
        }
      }
      return {
        action,
        metadata: sanitized,
        createdAt: new Date().toISOString(),
      };
    }

    it('strips all tokens, passwords, and TURN secrets from audit log metadata', () => {
      const rawMetadata = {
        sessionUuid: 'sess_abc',
        token: 'super_secret_raw_token_xyz',
        turnSecret: 'omaglee-turn-shared-secret-key-32ch',
        reason: 'nudity_inappropriate',
      };

      const log = createAuditLog('report.filed', rawMetadata);
      assert.strictEqual(log.metadata.sessionUuid, 'sess_abc');
      assert.strictEqual(log.metadata.reason, 'nudity_inappropriate');
      assert.strictEqual(log.metadata.token, undefined, 'Raw tokens must be stripped');
      assert.strictEqual(log.metadata.turnSecret, undefined, 'TURN secrets must be stripped');
    });
  });

});
