import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

describe('Phase 11: Functional, WebRTC Lifecycle & Network Reliability Suite', () => {

  // ==========================================
  // A1. START CHATTING & INITIALIZATION
  // ==========================================
  describe('A1. Start Chatting & Queue Initialization', () => {
    class StartChattingEngine {
      constructor() {
        this.sessions = new Map();
        this.queue = [];
        this.actionLocks = new Map();
      }

      acquireLock(sessionUuid, action, ttlMs = 1000) {
        const key = `${sessionUuid}:${action}`;
        const now = Date.now();
        const existing = this.actionLocks.get(key);
        if (existing && existing > now) return false;
        this.actionLocks.set(key, now + ttlMs);
        return true;
      }

      createSession() {
        const sessionUuid = `anon_${crypto.randomBytes(8).toString('hex')}`;
        const rawToken = crypto.randomBytes(16).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const session = {
          sessionUuid,
          rawToken,
          tokenHash,
          status: 'idle',
          activeMatchId: null,
          expiresAt: Date.now() + 7200000,
        };
        this.sessions.set(sessionUuid, session);
        return session;
      }

      startChatting(sessionUuid) {
        if (!this.acquireLock(sessionUuid, 'start_chat', 800)) {
          return { status: 429, error: 'duplicate_request_locked' };
        }
        const session = this.sessions.get(sessionUuid);
        if (!session) return { status: 401, error: 'invalid_session' };

        session.status = 'waiting';
        this.queue.push({
          sessionUuid,
          status: 'waiting',
          joinedAt: Date.now(),
        });
        return { status: 200, statusText: 'queued', sessionUuid };
      }
    }

    it('creates anonymous session with valid TTL and enters waiting queue', () => {
      const engine = new StartChattingEngine();
      const session = engine.createSession();
      assert.ok(session.sessionUuid.startsWith('anon_'));
      assert.strictEqual(session.status, 'idle');

      const res = engine.startChatting(session.sessionUuid);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.statusText, 'queued');
      assert.strictEqual(engine.queue.length, 1);
    });

    it('enforces single-flight lock to prevent duplicate rapid Start Chatting requests', () => {
      const engine = new StartChattingEngine();
      const session = engine.createSession();

      const firstAttempt = engine.startChatting(session.sessionUuid);
      assert.strictEqual(firstAttempt.status, 200);

      const immediateDuplicate = engine.startChatting(session.sessionUuid);
      assert.strictEqual(immediateDuplicate.status, 429);
      assert.strictEqual(immediateDuplicate.error, 'duplicate_request_locked');
      assert.strictEqual(engine.queue.length, 1, 'Only one queue entry should exist');
    });
  });

  // ==========================================
  // A2. ATOMIC MATCHMAKING INVARIANTS
  // ==========================================
  describe('A2. Matchmaking Atomicity & Invariants', () => {
    class MatchmakingEngine {
      constructor() {
        this.sessions = new Map();
        this.queue = [];
        this.matches = new Map();
      }

      addSession(uuid) {
        this.sessions.set(uuid, { sessionUuid: uuid, status: 'idle', activeMatchId: null });
      }

      matchOrQueue(sessionUuid) {
        const session = this.sessions.get(sessionUuid);
        if (session.activeMatchId) throw new Error('Participant already in active match');

        // Check if there is an eligible stranger
        const strangerIdx = this.queue.findIndex(q => q.sessionUuid !== sessionUuid);
        if (strangerIdx !== -1) {
          const stranger = this.queue.splice(strangerIdx, 1)[0];
          const strangerSession = this.sessions.get(stranger.sessionUuid);

          const matchId = `match_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          const matchObj = {
            matchId,
            status: 'active',
            participantAId: sessionUuid,
            participantBId: stranger.sessionUuid,
            startedAt: Date.now(),
          };

          this.matches.set(matchId, matchObj);
          session.activeMatchId = matchId;
          session.status = 'matched';
          strangerSession.activeMatchId = matchId;
          strangerSession.status = 'matched';

          return { status: 'matched', matchId, role: 'initiator' };
        }

        // No stranger available
        session.status = 'waiting';
        this.queue.push({ sessionUuid, joinedAt: Date.now() });
        return { status: 'waiting' };
      }

      cancelQueue(sessionUuid) {
        this.queue = this.queue.filter(q => q.sessionUuid !== sessionUuid);
        const s = this.sessions.get(sessionUuid);
        if (s && s.status === 'waiting') s.status = 'idle';
        return true;
      }
    }

    it('matches two solitary users atomically into exactly one active match', () => {
      const mm = new MatchmakingEngine();
      mm.addSession('alice');
      mm.addSession('bob');

      const resAlice = mm.matchOrQueue('alice');
      assert.strictEqual(resAlice.status, 'waiting');
      assert.strictEqual(mm.queue.length, 1);

      const resBob = mm.matchOrQueue('bob');
      assert.strictEqual(resBob.status, 'matched');
      assert.strictEqual(mm.queue.length, 0);

      const match = mm.matches.get(resBob.matchId);
      assert.ok(match);
      assert.strictEqual(match.participantAId, 'bob');
      assert.strictEqual(match.participantBId, 'alice');
      assert.strictEqual(mm.sessions.get('alice').activeMatchId, match.matchId);
      assert.strictEqual(mm.sessions.get('bob').activeMatchId, match.matchId);
    });

    it('enforces one active match per participant rule and rejects dual entry', () => {
      const mm = new MatchmakingEngine();
      mm.addSession('user_1');
      mm.addSession('user_2');
      mm.matchOrQueue('user_1');
      mm.matchOrQueue('user_2');

      assert.throws(() => {
        mm.matchOrQueue('user_1');
      }, /Participant already in active match/);
    });

    it('cancels queue waiting state cleanly without orphaned reservations', () => {
      const mm = new MatchmakingEngine();
      mm.addSession('user_charlie');
      mm.matchOrQueue('user_charlie');
      assert.strictEqual(mm.queue.length, 1);

      mm.cancelQueue('user_charlie');
      assert.strictEqual(mm.queue.length, 0);
      assert.strictEqual(mm.sessions.get('user_charlie').status, 'idle');
    });
  });

  // ==========================================
  // A3. NEXT AND STOP LIFECYCLE
  // ==========================================
  describe('A3. Next and Stop Call Lifecycle', () => {
    class CallLifecycleSimulator {
      constructor() {
        this.matches = new Map();
        this.queue = [];
      }

      createMatch(pA, pB) {
        const id = `match_${Date.now()}`;
        const match = { id, status: 'active', pA, pB, endedReason: null, endedAt: null };
        this.matches.set(id, match);
        return match;
      }

      handleNext(matchId, requestingPeer) {
        const match = this.matches.get(matchId);
        if (match && match.status === 'active') {
          match.status = 'ended';
          match.endedReason = 'next';
          match.endedAt = Date.now();
        }
        // Place requesting peer into queue for next match
        this.queue.push({ peer: requestingPeer, joinedAt: Date.now() });
        return { success: true, oldMatchEnded: true, status: 'searching_next' };
      }

      handleStop(matchId, requestingPeer) {
        const match = this.matches.get(matchId);
        if (match && match.status === 'active') {
          match.status = 'ended';
          match.endedReason = 'stopped';
          match.endedAt = Date.now();
        }
        // Remove from queue if waiting
        this.queue = this.queue.filter(q => q.peer !== requestingPeer);
        return { success: true, status: 'idle' };
      }
    }

    it('ends active match with reason next and immediately requeues caller', () => {
      const sim = new CallLifecycleSimulator();
      const match = sim.createMatch('user_1', 'user_2');

      const res = sim.handleNext(match.id, 'user_1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(match.status, 'ended');
      assert.strictEqual(match.endedReason, 'next');
      assert.strictEqual(sim.queue.length, 1);
      assert.strictEqual(sim.queue[0].peer, 'user_1');
    });

    it('ends match with reason stopped and resets caller to idle without requeueing', () => {
      const sim = new CallLifecycleSimulator();
      const match = sim.createMatch('user_1', 'user_2');

      const res = sim.handleStop(match.id, 'user_1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(match.status, 'ended');
      assert.strictEqual(match.endedReason, 'stopped');
      assert.strictEqual(sim.queue.length, 0);
    });
  });

  // ==========================================
  // A4 & A5. TRACK CLEANUP & WEBRTC PEER CONNECTION STATE
  // ==========================================
  describe('A4 & A5. Media Track Management & WebRTC Connection States', () => {
    class MockMediaTrack {
      constructor(kind) {
        this.kind = kind;
        this.enabled = true;
        this.stopped = false;
      }
      stop() {
        this.stopped = true;
      }
    }

    class MockPeerConnection {
      constructor() {
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        this.tracks = [];
      }

      addTrack(track) {
        this.tracks.push(track);
      }

      simulateConnectionProgress() {
        this.connectionState = 'connecting';
        this.iceConnectionState = 'checking';
      }

      simulateConnected() {
        this.connectionState = 'connected';
        this.iceConnectionState = 'connected';
      }

      close() {
        this.connectionState = 'closed';
        this.iceConnectionState = 'closed';
        this.tracks.forEach(t => t.stop());
      }
    }

    it('toggles audio and video track enablement without stopping underlying stream', () => {
      const audioTrack = new MockMediaTrack('audio');
      const videoTrack = new MockMediaTrack('video');

      audioTrack.enabled = false; // Muted
      assert.strictEqual(audioTrack.enabled, false);
      assert.strictEqual(audioTrack.stopped, false, 'Muting track must not stop hardware capture');

      videoTrack.enabled = false; // Video stopped
      assert.strictEqual(videoTrack.enabled, false);
      assert.strictEqual(videoTrack.stopped, false);
    });

    it('stops all tracks and transitions peer connection state to closed on session end', () => {
      const pc = new MockPeerConnection();
      const audioTrack = new MockMediaTrack('audio');
      const videoTrack = new MockMediaTrack('video');

      pc.addTrack(audioTrack);
      pc.addTrack(videoTrack);
      pc.simulateConnected();
      assert.strictEqual(pc.connectionState, 'connected');

      // Close call
      pc.close();
      assert.strictEqual(pc.connectionState, 'closed');
      assert.strictEqual(pc.iceConnectionState, 'closed');
      assert.strictEqual(audioTrack.stopped, true, 'Audio track must be released');
      assert.strictEqual(videoTrack.stopped, true, 'Video track must be released');
    });
  });

  // ==========================================
  // B1 - B7. NETWORK & TURN RELAY FALLBACK
  // ==========================================
  describe('B1-B7. Network Routing & TURN Relay Fallback', () => {
    function classifyCandidatePair(localType, remoteType) {
      if (!localType || !remoteType) return 'unknown';
      if (localType === 'relay' || remoteType === 'relay') return 'turn_relay';
      if ((localType === 'host' || localType === 'srflx') && (remoteType === 'host' || remoteType === 'srflx')) {
        return 'direct_p2p';
      }
      return 'unknown';
    }

    function calculateBandwidthKbps(bytesDelta, intervalSeconds) {
      if (intervalSeconds <= 0 || bytesDelta <= 0) return 0;
      const bits = bytesDelta * 8;
      return Math.round((bits / (intervalSeconds * 1000)) * 10) / 10;
    }

    it('classifies direct host/srflx paths as direct_p2p', () => {
      assert.strictEqual(classifyCandidatePair('host', 'host'), 'direct_p2p');
      assert.strictEqual(classifyCandidatePair('srflx', 'srflx'), 'direct_p2p');
      assert.strictEqual(classifyCandidatePair('host', 'srflx'), 'direct_p2p');
    });

    it('classifies relay candidate paths as turn_relay', () => {
      assert.strictEqual(classifyCandidatePair('relay', 'host'), 'turn_relay');
      assert.strictEqual(classifyCandidatePair('host', 'relay'), 'turn_relay');
      assert.strictEqual(classifyCandidatePair('relay', 'relay'), 'turn_relay');
    });

    it('calculates instantaneous bandwidth from byte deltas over time', () => {
      // 250,000 bytes over 2 seconds:
      // (250,000 * 8) / (2 * 1000) = 2,000,000 / 2000 = 1000 kbps (1 Mbps)
      const kbps = calculateBandwidthKbps(250000, 2);
      assert.strictEqual(kbps, 1000);
    });

    it('enforces relay-only policy when privacy mode is enabled', () => {
      function configureRtcOptions(privacyMode) {
        return {
          iceTransportPolicy: privacyMode ? 'relay' : 'all',
          bundlePolicy: 'max-bundle',
        };
      }

      assert.strictEqual(configureRtcOptions(true).iceTransportPolicy, 'relay');
      assert.strictEqual(configureRtcOptions(false).iceTransportPolicy, 'all');
    });

    it('validates Coturn HMAC-SHA1 ephemeral credentials and rejects expired timestamps', () => {
      const turnSecret = 'test_secret_32chars_long_123456';
      const nowUnix = Math.floor(Date.now() / 1000);

      function generateCredentials(sessionUuid, ttlSeconds = 600) {
        const expiry = nowUnix + ttlSeconds;
        const username = `${expiry}:${sessionUuid}`;
        const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
        return { username, credential, expiry };
      }

      function verifyCredentials(username, credential) {
        const [expiryStr] = username.split(':');
        const expiry = parseInt(expiryStr, 10);
        if (Math.floor(Date.now() / 1000) > expiry) return { valid: false, reason: 'expired' };

        const expectedCred = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
        if (credential !== expectedCred) return { valid: false, reason: 'signature_mismatch' };
        return { valid: true };
      }

      const creds = generateCredentials('user_alice', 600);
      assert.strictEqual(verifyCredentials(creds.username, creds.credential).valid, true);

      // Tampered signature
      assert.strictEqual(verifyCredentials(creds.username, 'bad_signature').valid, false);

      // Expired credentials
      const expiredCreds = generateCredentials('user_bob', -10);
      const expiredCheck = verifyCredentials(expiredCreds.username, expiredCreds.credential);
      assert.strictEqual(expiredCheck.valid, false);
      assert.strictEqual(expiredCheck.reason, 'expired');
    });
  });
});
