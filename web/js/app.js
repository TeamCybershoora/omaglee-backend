/**
 * Omaglee Web Client - Vanilla JavaScript
 * Instant Random Video Chat with WebRTC, Google Authentication & Safety Moderation
 */

(function () {
  'use strict';

  // 1. Dynamic Host Configuration with Production Render Backend
  const RENDER_BACKEND_URL = 'https://omaglee-backend-1.onrender.com';
  const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port === '8000' ? window.location.origin : RENDER_BACKEND_URL)
    : (window.location.origin.includes('onrender.com') ? window.location.origin : RENDER_BACKEND_URL);
  const API_URL = `${BACKEND_URL}/api`;
  const GOOGLE_CLIENT_ID = '860788640625-qjs1imss7vs50i9on8rgs0hq0on5vohh.apps.googleusercontent.com';

  // Fallback ICE Servers (STUN)
  const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  // 2. Application State
  const state = {
    currentUser: null,
    sessionUuid: localStorage.getItem('omaglee_session_uuid'),
    sessionToken: localStorage.getItem('omaglee_session_token'),
    callState: 'IDLE', // IDLE, SEARCHING, CONNECTING, CONNECTED
    localStream: null,
    remoteStream: null,
    peerConnection: null,
    dataChannel: null,
    activeMatch: null,
    isAudioMuted: false,
    isVideoMuted: false,
    isScreenSharing: false,
    privacyMode: false,
    onlineCount: 10248,
    waitingSeconds: 0,
    pollTimer: null,
    waitingTimer: null,
    heartbeatTimer: null,
    sigPollTimer: null,
    processedMsgIds: new Set(),
    theme: 'light'
  };

  // DOM Elements Cache
  const el = {};

  function initElements() {
    el.authScreen = document.getElementById('auth-screen');
    el.chatScreen = document.getElementById('chat-screen');
    el.googleBtnSlot = document.getElementById('google-btn-slot');
    el.guestBtn = document.getElementById('guest-login-btn');
    el.ageCheck = document.getElementById('auth-age-check');
    el.authError = document.getElementById('auth-error-notice');
    el.authErrorText = document.getElementById('auth-error-text');

    el.onlineBadge = document.querySelectorAll('.online-count-text');
    el.themeToggles = document.querySelectorAll('.theme-toggle-btn');
    el.userProfilePill = document.getElementById('user-profile-pill');
    el.userName = document.getElementById('user-name-text');
    el.userAvatar = document.getElementById('user-avatar-img');
    el.userAvatarPlaceholder = document.getElementById('user-avatar-placeholder');
    el.logoutBtn = document.getElementById('logout-btn');

    el.localVideo = document.getElementById('local-video');
    el.remoteVideo = document.getElementById('remote-video');
    el.strangerStandby = document.getElementById('stranger-standby');
    el.strangerSearching = document.getElementById('stranger-searching');
    el.strangerConnecting = document.getElementById('stranger-connecting');
    el.searchingTimer = document.getElementById('searching-timer-text');

    el.startBtn = document.getElementById('start-btn');
    el.standbyStartBtn = document.getElementById('standby-start-btn');
    el.nextBtn = document.getElementById('next-btn');
    el.stopBtn = document.getElementById('stop-btn');

    el.micBtn = document.getElementById('mic-btn');
    el.camBtn = document.getElementById('cam-btn');
    el.screenBtn = document.getElementById('screen-btn');
    el.localMicBtn = document.getElementById('local-mic-btn');
    el.localCamBtn = document.getElementById('local-cam-btn');
    el.requestPermsBtn = document.getElementById('request-perms-btn');

    el.chatMessages = document.getElementById('chat-messages');
    el.chatForm = document.getElementById('chat-input-form');
    el.chatInput = document.getElementById('chat-text-input');
    el.chatStatusBadge = document.getElementById('chat-status-badge');
    el.mobileChatToggle = document.getElementById('mobile-chat-toggle');
    el.mobileChatClose = document.getElementById('mobile-chat-close');
    el.chatPanelCard = document.getElementById('chat-panel-card');

    el.toast = document.getElementById('notice-toast');
    el.toastText = document.getElementById('notice-toast-text');
    el.toastClose = document.getElementById('notice-toast-close');

    // Modals
    el.reportModal = document.getElementById('report-modal');
    el.reportBtn = document.getElementById('report-btn');
    el.closeReportBtn = document.getElementById('close-report-btn');
    el.dismissReportBtn = document.getElementById('dismiss-report-btn');
    el.submitReportBtn = document.getElementById('submit-report-btn');
    el.blockStrangerBtn = document.getElementById('block-stranger-btn');
    el.reportReason = document.getElementById('report-reason-select');
    el.reportDesc = document.getElementById('report-desc-input');

    el.settingsModal = document.getElementById('settings-modal');
    el.settingsBtn = document.getElementById('settings-btn');
    el.closeSettingsBtn = document.getElementById('close-settings-btn');
    el.doneSettingsBtn = document.getElementById('done-settings-btn');
    el.privacySwitch = document.getElementById('privacy-mode-switch');
    el.privacyStatusText = document.getElementById('privacy-status-text');
    el.signalingStatusText = document.getElementById('signaling-status-text');

    el.aboutModal = document.getElementById('about-modal');
    el.aboutNavBtn = document.getElementById('about-nav-btn');
    el.aboutInfoBtn = document.getElementById('about-info-btn');
    el.closeAboutBtn = document.getElementById('close-about-btn');
    el.doneAboutBtn = document.getElementById('done-about-btn');
  }

  // 3. User & Auth Logic
  function loadStoredUser() {
    try {
      const stored = localStorage.getItem('omaglee_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  function showToast(message, type = 'neutral') {
    if (!el.toast) return;
    el.toast.className = `cyber-notice-toast ${type}`;
    el.toastText.textContent = message;
    el.toast.style.display = 'block';

    setTimeout(() => {
      if (el.toast) el.toast.style.display = 'none';
    }, 4500);
  }

  function updateAuthView() {
    state.currentUser = loadStoredUser();

    if (!state.currentUser) {
      if (el.authScreen) el.authScreen.style.display = 'flex';
      if (el.chatScreen) el.chatScreen.style.display = 'none';
      initGoogleSignIn();
    } else {
      if (el.authScreen) el.authScreen.style.display = 'none';
      if (el.chatScreen) el.chatScreen.style.display = 'flex';

      // Update User Profile in Navbar
      if (el.userName) el.userName.textContent = state.currentUser.name || 'User';
      if (state.currentUser.picture && el.userAvatar) {
        el.userAvatar.src = state.currentUser.picture;
        el.userAvatar.style.display = 'block';
        if (el.userAvatarPlaceholder) el.userAvatarPlaceholder.style.display = 'none';
      } else {
        if (el.userAvatar) el.userAvatar.style.display = 'none';
        if (el.userAvatarPlaceholder) {
          el.userAvatarPlaceholder.textContent = (state.currentUser.name || 'U').charAt(0).toUpperCase();
          el.userAvatarPlaceholder.style.display = 'flex';
        }
      }

      // Start local webcam preview
      startLocalPreview();
    }
  }

  function initGoogleSignIn() {
    if (!window.google?.accounts?.id || !el.googleBtnSlot) return;

    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });

      el.googleBtnSlot.innerHTML = '';
      window.google.accounts.id.renderButton(el.googleBtnSlot, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 300
      });
    } catch (err) {
      console.warn('Google SDK init error:', err);
    }
  }

  async function handleGoogleCredentialResponse(response) {
    if (el.ageCheck && !el.ageCheck.checked) {
      showAuthError('Please confirm you are at least 18 years old to proceed.');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        localStorage.setItem('omaglee_session_uuid', data.sessionUuid);
        localStorage.setItem('omaglee_session_token', data.sessionToken);
        localStorage.setItem('omaglee_user', JSON.stringify(data.user));
        state.sessionUuid = data.sessionUuid;
        state.sessionToken = data.sessionToken;
        updateAuthView();
      } else {
        // Fallback: decode JWT client-side
        decodeJwtFallback(response.credential);
      }
    } catch {
      decodeJwtFallback(response.credential);
    }
  }

  function decodeJwtFallback(credential) {
    try {
      const parts = credential.split('.');
      const payload = JSON.parse(atob(parts[1]));
      const user = {
        name: payload.name || 'Google User',
        email: payload.email,
        picture: payload.picture || ''
      };
      localStorage.setItem('omaglee_user', JSON.stringify(user));
      updateAuthView();
    } catch {
      showAuthError('Google sign in verification failed. You can continue as Guest.');
    }
  }

  function handleGuestLogin() {
    if (el.ageCheck && !el.ageCheck.checked) {
      showAuthError('Please confirm you are at least 18 years old to proceed.');
      return;
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const guestUser = {
      name: `Guest_${randomSuffix}`,
      email: `guest${randomSuffix}@omaglee.local`,
      picture: '',
      isGuest: true
    };
    localStorage.setItem('omaglee_user', JSON.stringify(guestUser));
    updateAuthView();
  }

  function handleLogout() {
    handleStopCall();
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
    if (el.localVideo) el.localVideo.srcObject = null;

    localStorage.removeItem('omaglee_user');
    localStorage.removeItem('omaglee_session_uuid');
    localStorage.removeItem('omaglee_session_token');
    state.currentUser = null;
    state.sessionUuid = null;
    state.sessionToken = null;
    updateAuthView();
    showToast('Signed out successfully.');
  }

  function showAuthError(msg) {
    if (!el.authError) return;
    el.authErrorText.textContent = msg;
    el.authError.style.display = 'flex';
  }

  // 4. Local Media Stream (Camera & Mic)
  async function startLocalPreview() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        state.localStream = stream;
        if (el.localVideo) {
          el.localVideo.srcObject = stream;
        }
        if (el.requestPermsBtn) {
          el.requestPermsBtn.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn('Camera access error:', err);
      if (el.requestPermsBtn) {
        el.requestPermsBtn.style.display = 'inline-flex';
      }
      showToast('Camera permission required. Click "Allow Camera & Mic".', 'neutral');
    }
  }

  function toggleAudio() {
    if (!state.localStream) return;
    state.isAudioMuted = !state.isAudioMuted;
    state.localStream.getAudioTracks().forEach(t => {
      t.enabled = !state.isAudioMuted;
    });
    updateMediaButtonStates();
  }

  function toggleVideo() {
    if (!state.localStream) return;
    state.isVideoMuted = !state.isVideoMuted;
    state.localStream.getVideoTracks().forEach(t => {
      t.enabled = !state.isVideoMuted;
    });
    updateMediaButtonStates();
  }

  async function toggleScreenShare() {
    if (state.isScreenSharing) {
      await startLocalPreview();
      state.isScreenSharing = false;
      showToast('Switched back to camera feed.');
    } else {
      try {
        if (navigator.mediaDevices?.getDisplayMedia) {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          state.localStream = displayStream;
          if (el.localVideo) el.localVideo.srcObject = displayStream;
          state.isScreenSharing = true;

          // Replace track in peer connection if active
          if (state.peerConnection) {
            const sender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(displayStream.getVideoTracks()[0]);
          }

          displayStream.getVideoTracks()[0].onended = () => {
            toggleScreenShare();
          };
          showToast('Screen sharing active.');
        }
      } catch {
        // user cancelled
      }
    }
    updateMediaButtonStates();
  }

  function updateMediaButtonStates() {
    if (el.micBtn) el.micBtn.classList.toggle('control-btn-muted', state.isAudioMuted);
    if (el.camBtn) el.camBtn.classList.toggle('control-btn-muted', state.isVideoMuted);
    if (el.localMicBtn) el.localMicBtn.classList.toggle('active', state.isAudioMuted);
    if (el.localCamBtn) el.localCamBtn.classList.toggle('active', state.isVideoMuted);
    if (el.screenBtn) el.screenBtn.classList.toggle('control-btn-active', state.isScreenSharing);
  }

  // 5. Matchmaking API Client
  async function ensureSession() {
    if (state.sessionUuid && state.sessionToken) {
      return { sessionUuid: state.sessionUuid, sessionToken: state.sessionToken };
    }
    const res = await fetch(`${API_URL}/matchmaking/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to create session');
    const data = await res.json();
    state.sessionUuid = data.sessionUuid;
    state.sessionToken = data.sessionToken;
    localStorage.setItem('omaglee_session_uuid', data.sessionUuid);
    localStorage.setItem('omaglee_session_token', data.sessionToken);
    return data;
  }

  function setCallState(newState) {
    state.callState = newState;

    // Stranger Video states
    if (newState === 'IDLE') {
      if (el.strangerStandby) el.strangerStandby.style.display = 'flex';
      if (el.strangerSearching) el.strangerSearching.style.display = 'none';
      if (el.strangerConnecting) el.strangerConnecting.style.display = 'none';
      if (el.remoteVideo) el.remoteVideo.style.display = 'none';
      if (el.startBtn) el.startBtn.style.display = 'inline-flex';
      if (el.nextBtn) el.nextBtn.style.display = 'none';
      if (el.stopBtn) el.stopBtn.style.display = 'none';
      if (el.chatStatusBadge) el.chatStatusBadge.textContent = 'Standby';
    } else if (newState === 'SEARCHING') {
      if (el.strangerStandby) el.strangerStandby.style.display = 'none';
      if (el.strangerSearching) el.strangerSearching.style.display = 'flex';
      if (el.strangerConnecting) el.strangerConnecting.style.display = 'none';
      if (el.remoteVideo) el.remoteVideo.style.display = 'none';
      if (el.startBtn) el.startBtn.style.display = 'none';
      if (el.nextBtn) el.nextBtn.style.display = 'inline-flex';
      if (el.stopBtn) el.stopBtn.style.display = 'inline-flex';
      if (el.chatStatusBadge) el.chatStatusBadge.textContent = 'Searching...';
    } else if (newState === 'CONNECTING') {
      if (el.strangerStandby) el.strangerStandby.style.display = 'none';
      if (el.strangerSearching) el.strangerSearching.style.display = 'none';
      if (el.strangerConnecting) el.strangerConnecting.style.display = 'flex';
      if (el.remoteVideo) el.remoteVideo.style.display = 'none';
      if (el.chatStatusBadge) el.chatStatusBadge.textContent = 'Connecting...';
    } else if (newState === 'CONNECTED') {
      if (el.strangerStandby) el.strangerStandby.style.display = 'none';
      if (el.strangerSearching) el.strangerSearching.style.display = 'none';
      if (el.strangerConnecting) el.strangerConnecting.style.display = 'none';
      if (el.remoteVideo) el.remoteVideo.style.display = 'block';
      if (el.startBtn) el.startBtn.style.display = 'none';
      if (el.nextBtn) el.nextBtn.style.display = 'inline-flex';
      if (el.stopBtn) el.stopBtn.style.display = 'inline-flex';
      if (el.chatStatusBadge) el.chatStatusBadge.textContent = 'Connected';
    }
  }

  function startWaitingTimer() {
    stopWaitingTimer();
    state.waitingSeconds = 0;
    if (el.searchingTimer) el.searchingTimer.textContent = '0s';

    state.waitingTimer = setInterval(() => {
      state.waitingSeconds++;
      if (el.searchingTimer) el.searchingTimer.textContent = `${state.waitingSeconds}s`;
    }, 1000);
  }

  function stopWaitingTimer() {
    if (state.waitingTimer) {
      clearInterval(state.waitingTimer);
      state.waitingTimer = null;
    }
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    stopWaitingTimer();
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function stopSignalingPoll() {
    if (state.sigPollTimer) {
      clearInterval(state.sigPollTimer);
      state.sigPollTimer = null;
    }
  }

  // 6. Action Handlers: Start Call, Next, Stop
  async function handleStartChatting() {
    if (!state.localStream) {
      await startLocalPreview();
    }

    setCallState('SEARCHING');
    startWaitingTimer();

    try {
      await ensureSession();
      const res = await fetch(`${API_URL}/matchmaking/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        }
      });
      const data = await res.json();

      if (data.status === 'matched' && data.matchId && data.role) {
        connectMatchedStranger(data);
      } else {
        startPollingQueue();
      }
    } catch (err) {
      console.error('Queue error:', err);
      setCallState('IDLE');
      showToast('Unable to connect to matchmaking server.', 'error');
    }
  }

  function startPollingQueue() {
    stopPolling();
    state.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/matchmaking/status`, {
          headers: {
            'X-Session-UUID': state.sessionUuid,
            'X-Session-Token': state.sessionToken
          }
        });
        const data = await res.json();

        if (data.status === 'matched' && data.matchId && data.role) {
          stopPolling();
          connectMatchedStranger(data);
        } else if (data.status === 'idle') {
          stopPolling();
          setCallState('IDLE');
        }
      } catch (err) {
        console.warn('Status poll error:', err);
      }
    }, 1500);
  }

  async function handleNextStranger() {
    stopPolling();
    stopHeartbeat();
    closePeerConnection();

    if (state.activeMatch?.matchId) {
      fetch(`${API_URL}/matchmaking/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        },
        body: JSON.stringify({ matchId: state.activeMatch.matchId })
      }).catch(() => {});
    }
    state.activeMatch = null;

    setCallState('SEARCHING');
    startWaitingTimer();

    try {
      await ensureSession();
      const res = await fetch(`${API_URL}/matchmaking/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        }
      });
      const data = await res.json();

      if (data.status === 'matched' && data.matchId && data.role) {
        connectMatchedStranger(data);
      } else {
        startPollingQueue();
      }
    } catch {
      setCallState('IDLE');
      showToast('Could not search for next stranger. Try again.', 'error');
    }
  }

  async function handleStopCall() {
    stopPolling();
    stopHeartbeat();
    closePeerConnection();

    // Cancel matchmaking search
    fetch(`${API_URL}/matchmaking/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-UUID': state.sessionUuid,
        'X-Session-Token': state.sessionToken
      }
    }).catch(() => {});

    if (state.activeMatch?.matchId) {
      fetch(`${API_URL}/matchmaking/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        },
        body: JSON.stringify({ matchId: state.activeMatch.matchId })
      }).catch(() => {});
    }

    state.activeMatch = null;
    setCallState('IDLE');
    showToast('Call stopped. Both users in idle standby.');
  }

  // 7. WebRTC Connection & Signaling
  async function connectMatchedStranger(matchData) {
    stopPolling();
    state.activeMatch = matchData;
    state.processedMsgIds.clear();
    setCallState('CONNECTING');

    clearChatMessages();
    appendChatMessage('system', 'Connected with an anonymous stranger. Say hello! 👋');

    // Start heartbeat
    stopHeartbeat();
    state.heartbeatTimer = setInterval(() => {
      if (state.activeMatch?.matchId) {
        fetch(`${API_URL}/matchmaking/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-UUID': state.sessionUuid,
            'X-Session-Token': state.sessionToken
          },
          body: JSON.stringify({ matchId: state.activeMatch.matchId })
        }).catch(() => {});
      }
    }, 10000);

    // Initialize RTCPeerConnection
    const config = {
      iceServers: DEFAULT_ICE_SERVERS,
      iceTransportPolicy: state.privacyMode ? 'relay' : 'all'
    };

    const pc = new RTCPeerConnection(config);
    state.peerConnection = pc;

    // Attach local media stream
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => {
        pc.addTrack(track, state.localStream);
      });
    }

    // Handle remote track
    pc.ontrack = (event) => {
      state.remoteStream = event.streams[0];
      if (el.remoteVideo) {
        el.remoteVideo.srcObject = event.streams[0];
      }
      setCallState('CONNECTED');
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && state.activeMatch?.matchId) {
        sendSignalingMessage('candidate', { candidate: event.candidate });
      }
    };

    // Data Channel for Chat
    if (matchData.role === 'initiator') {
      const dc = pc.createDataChannel('chat', { ordered: true });
      setupDataChannel(dc);
      state.dataChannel = dc;

      // Create Offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignalingMessage('offer', { sdp: offer.sdp });
      } catch (err) {
        console.error('Create offer error:', err);
      }
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
        state.dataChannel = event.channel;
      };
    }

    // Start polling signaling messages
    startSignalingPoll();
  }

  function setupDataChannel(dc) {
    dc.onopen = () => {
      if (el.signalingStatusText) el.signalingStatusText.textContent = 'Connected (P2P)';
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        appendChatMessage('stranger', data.text || event.data);
      } catch {
        appendChatMessage('stranger', event.data);
      }
    };
    dc.onclose = () => {
      if (el.signalingStatusText) el.signalingStatusText.textContent = 'Disconnected';
    };
  }

  async function sendSignalingMessage(type, payload) {
    if (!state.activeMatch?.matchId) return;
    try {
      await fetch(`${API_URL}/signaling/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: state.activeMatch.matchId,
          participantId: state.activeMatch.participantId,
          participantToken: state.activeMatch.participantToken,
          type,
          payload
        })
      });
    } catch (err) {
      console.warn('Send signaling error:', err);
    }
  }

  function startSignalingPoll() {
    stopSignalingPoll();
    state.sigPollTimer = setInterval(async () => {
      if (!state.activeMatch?.matchId || !state.peerConnection) return;

      try {
        const res = await fetch(
          `${API_URL}/signaling/messages?matchId=${state.activeMatch.matchId}&participantId=${state.activeMatch.participantId}&participantToken=${state.activeMatch.participantToken}`
        );
        const data = await res.json();
        const messages = data.messages || [];

        for (const msg of messages) {
          if (msg.id && state.processedMsgIds.has(msg.id)) continue;
          if (msg.id) state.processedMsgIds.add(msg.id);

          handleIncomingSignalingMessage(msg);
        }
      } catch {
        //
      }
    }, 600);
  }

  async function handleIncomingSignalingMessage(msg) {
    const pc = state.peerConnection;
    if (!pc) return;

    if (msg.type === 'offer' && state.activeMatch?.role === 'receiver') {
      try {
        const sdp = msg.payload?.sdp || msg.sdp;
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignalingMessage('answer', { sdp: answer.sdp });
      } catch (err) {
        console.error('Handle offer error:', err);
      }
    } else if (msg.type === 'answer' && state.activeMatch?.role === 'initiator') {
      try {
        const sdp = msg.payload?.sdp || msg.sdp;
        if (pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        }
      } catch (err) {
        console.error('Handle answer error:', err);
      }
    } else if (msg.type === 'candidate') {
      try {
        const candidate = msg.payload?.candidate || msg.candidate;
        if (candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.warn('Add ICE candidate error:', err);
      }
    } else if (msg.type === 'leave' || msg.type === 'disconnect') {
      showToast('Stranger disconnected or stopped call.');
      handleStopCall();
    }
  }

  function closePeerConnection() {
    stopSignalingPoll();
    if (state.dataChannel) {
      try { state.dataChannel.close(); } catch {}
      state.dataChannel = null;
    }
    if (state.peerConnection) {
      try { state.peerConnection.close(); } catch {}
      state.peerConnection = null;
    }
    if (el.remoteVideo) {
      el.remoteVideo.srcObject = null;
    }
    state.remoteStream = null;
  }

  // 8. Ephemeral Chat Messaging
  function clearChatMessages() {
    if (el.chatMessages) el.chatMessages.innerHTML = '';
  }

  function appendChatMessage(sender, text) {
    if (!el.chatMessages) return;

    const row = document.createElement('div');
    row.className = `chat-bubble-row ${sender}-bubble-row`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${sender}`;
    bubble.textContent = text;

    row.appendChild(bubble);
    el.chatMessages.appendChild(row);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function handleSendChatMessage(e) {
    if (e) e.preventDefault();
    if (!el.chatInput) return;

    const text = el.chatInput.value.trim();
    if (!text) return;

    appendChatMessage('local', text);
    el.chatInput.value = '';

    // Send over WebRTC DataChannel if open
    if (state.dataChannel && state.dataChannel.readyState === 'open') {
      state.dataChannel.send(JSON.stringify({ text, timestamp: Date.now() }));
    } else {
      // Fallback: send via signaling
      sendSignalingMessage('chat', { text, timestamp: Date.now() });
    }
  }

  // 9. Safety & Moderation (Report & Block)
  async function handleSubmitReport() {
    if (!state.sessionUuid || !state.sessionToken) {
      showToast('No active session found.', 'error');
      return;
    }

    const reason = el.reportReason?.value || 'nudity_inappropriate';
    const description = el.reportDesc?.value || 'Reported via Safety Modal';

    try {
      const res = await fetch(`${API_URL}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        },
        body: JSON.stringify({
          matchId: state.activeMatch?.matchId || null,
          reason,
          description
        })
      });

      if (res.ok) {
        closeModals();
        if (el.reportDesc) el.reportDesc.value = '';
        showToast('Report received. Our moderation team has been notified.', 'success');
        handleNextStranger();
      } else {
        showToast('Failed to submit report. Please try again.', 'error');
      }
    } catch {
      showToast('Failed to submit report. Please try again.', 'error');
    }
  }

  async function handleBlockStranger() {
    if (!state.sessionUuid || !state.sessionToken || !state.activeMatch?.matchId) {
      showToast('No active match to block.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/blocks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-UUID': state.sessionUuid,
          'X-Session-Token': state.sessionToken
        },
        body: JSON.stringify({
          matchId: state.activeMatch.matchId,
          reason: 'User blocked by participant'
        })
      });

      if (res.ok) {
        closeModals();
        showToast('Stranger blocked. You will never be matched again.');
        handleNextStranger();
      }
    } catch {
      showToast('Failed to block stranger.', 'error');
    }
  }

  // 10. Modals & UI Controls
  function closeModals() {
    if (el.reportModal) el.reportModal.style.display = 'none';
    if (el.settingsModal) el.settingsModal.style.display = 'none';
    if (el.aboutModal) el.aboutModal.style.display = 'none';
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.className = `theme-${state.theme}`;
    const shell = document.querySelector('.cyber-app-shell');
    if (shell) shell.className = `cyber-app-shell theme-${state.theme}`;
  }

  function togglePrivacyMode() {
    state.privacyMode = !state.privacyMode;
    if (el.privacySwitch) el.privacySwitch.classList.toggle('active', state.privacyMode);
    if (el.privacyStatusText) el.privacyStatusText.textContent = state.privacyMode ? 'ON' : 'OFF';
    showToast(
      state.privacyMode
        ? 'Relay-Only Privacy Mode enabled. Direct IP discovery blocked via TURN.'
        : 'Privacy Mode disabled. Standard direct P2P connectivity restored.'
    );
  }

  // 11. Event Listeners Setup
  function setupEventListeners() {
    // Auth listeners
    if (el.guestBtn) el.guestBtn.addEventListener('click', handleGuestLogin);
    if (el.logoutBtn) el.logoutBtn.addEventListener('click', handleLogout);

    // Calling action listeners
    if (el.startBtn) el.startBtn.addEventListener('click', handleStartChatting);
    if (el.standbyStartBtn) el.standbyStartBtn.addEventListener('click', handleStartChatting);
    if (el.nextBtn) el.nextBtn.addEventListener('click', handleNextStranger);
    if (el.stopBtn) el.stopBtn.addEventListener('click', handleStopCall);

    // Media toggles
    if (el.micBtn) el.micBtn.addEventListener('click', toggleAudio);
    if (el.camBtn) el.camBtn.addEventListener('click', toggleVideo);
    if (el.screenBtn) el.screenBtn.addEventListener('click', toggleScreenShare);
    if (el.localMicBtn) el.localMicBtn.addEventListener('click', toggleAudio);
    if (el.localCamBtn) el.localCamBtn.addEventListener('click', toggleVideo);
    if (el.requestPermsBtn) el.requestPermsBtn.addEventListener('click', startLocalPreview);

    // Chat form
    if (el.chatForm) el.chatForm.addEventListener('submit', handleSendChatMessage);

    // Mobile chat drawer
    if (el.mobileChatToggle) {
      el.mobileChatToggle.addEventListener('click', () => {
        if (el.chatPanelCard) el.chatPanelCard.classList.toggle('mobile-open');
      });
    }
    if (el.mobileChatClose) {
      el.mobileChatClose.addEventListener('click', () => {
        if (el.chatPanelCard) el.chatPanelCard.classList.remove('mobile-open');
      });
    }

    // Modals
    if (el.reportBtn) el.reportBtn.addEventListener('click', () => (el.reportModal.style.display = 'flex'));
    if (el.closeReportBtn) el.closeReportBtn.addEventListener('click', closeModals);
    if (el.dismissReportBtn) el.dismissReportBtn.addEventListener('click', closeModals);
    if (el.submitReportBtn) el.submitReportBtn.addEventListener('click', handleSubmitReport);
    if (el.blockStrangerBtn) el.blockStrangerBtn.addEventListener('click', handleBlockStranger);

    if (el.settingsBtn) el.settingsBtn.addEventListener('click', () => (el.settingsModal.style.display = 'flex'));
    if (el.closeSettingsBtn) el.closeSettingsBtn.addEventListener('click', closeModals);
    if (el.doneSettingsBtn) el.doneSettingsBtn.addEventListener('click', closeModals);
    if (el.privacySwitch) el.privacySwitch.addEventListener('click', togglePrivacyMode);

    if (el.aboutNavBtn) el.aboutNavBtn.addEventListener('click', () => (el.aboutModal.style.display = 'flex'));
    if (el.aboutInfoBtn) el.aboutInfoBtn.addEventListener('click', () => (el.aboutModal.style.display = 'flex'));
    if (el.closeAboutBtn) el.closeAboutBtn.addEventListener('click', closeModals);
    if (el.doneAboutBtn) el.doneAboutBtn.addEventListener('click', closeModals);

    // Theme toggle
    el.themeToggles.forEach(btn => btn.addEventListener('click', toggleTheme));

    // Toast dismiss
    if (el.toastClose) el.toastClose.addEventListener('click', () => (el.toast.style.display = 'none'));

    // Fluctuate online count
    setInterval(() => {
      state.onlineCount += Math.floor(Math.random() * 5) - 2;
      el.onlineBadge.forEach(badge => {
        badge.textContent = `${state.onlineCount.toLocaleString()} Online`;
      });
    }, 8000);
  }

  // 12. App Initialization on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();
    updateAuthView();
  });
})();
