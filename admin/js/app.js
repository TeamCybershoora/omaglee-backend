/**
 * Omaglee Admin Dashboard - Vanilla JavaScript
 * Real-time User Moderation, Abuse Reporting, WebRTC Analytics & System Management
 */

(function () {
  'use strict';

  // 1. Dynamic API Host with Production Render Backend
  const RENDER_BACKEND_URL = 'https://omaglee-backend-1.onrender.com';
  const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port === '8000' ? window.location.origin : RENDER_BACKEND_URL)
    : (window.location.origin.includes('onrender.com') ? window.location.origin : RENDER_BACKEND_URL);
  const API_URL = `${BACKEND_URL}/api`;

  // 2. State
  const state = {
    token: localStorage.getItem('omaglee_admin_token'),
    currentUser: (() => {
      try {
        const u = localStorage.getItem('omaglee_admin_user');
        return u ? JSON.parse(u) : null;
      } catch {
        return null;
      }
    })(),
    activeTab: 'overview',
    refreshInterval: null,
    activeReport: null,
    usersSearch: '',
    usersFilter: 'all',
    reportsFilter: 'all',
    matchesFilter: 'all'
  };

  // Helper for Auth Headers
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    };
  }

  // DOM Elements
  const el = {};

  function initElements() {
    el.loginView = document.getElementById('login-view');
    el.dashboardView = document.getElementById('dashboard-view');
    el.loginForm = document.getElementById('login-form');
    el.usernameInput = document.getElementById('login-username');
    el.passwordInput = document.getElementById('login-password');
    el.loginError = document.getElementById('login-error');
    el.loginBtn = document.getElementById('login-submit-btn');

    el.adminNameText = document.getElementById('admin-name-text');
    el.adminRoleBadge = document.getElementById('admin-role-badge');
    el.logoutBtn = document.getElementById('admin-logout-btn');
    el.refreshBtn = document.getElementById('admin-refresh-btn');
    el.navItems = document.querySelectorAll('.nav-item');
    el.tabPanes = document.querySelectorAll('.tab-content-pane');
    el.pageTitle = document.getElementById('page-title-text');

    // Modals
    el.reviewModal = document.getElementById('review-modal');
    el.closeReviewBtn = document.getElementById('close-review-btn');
    el.createBanModal = document.getElementById('create-ban-modal');
    el.closeCreateBanBtn = document.getElementById('close-create-ban-btn');
    el.openCreateBanBtn = document.getElementById('open-create-ban-btn');
    el.createBanForm = document.getElementById('create-ban-form');

    // Search & Filter elements
    el.userSearchInput = document.getElementById('user-search-input');
    el.userStatusSelect = document.getElementById('user-status-select');
    el.reportFilterSelect = document.getElementById('report-filter-select');
    el.matchFilterSelect = document.getElementById('match-filter-select');

    // Settings Form
    el.settingsForm = document.getElementById('settings-form');
  }

  // 3. Authentication & View Switch
  function updateAuthView() {
    if (!state.token || !state.currentUser) {
      if (el.loginView) el.loginView.style.display = 'flex';
      if (el.dashboardView) el.dashboardView.style.display = 'none';
      if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
      }
    } else {
      if (el.loginView) el.loginView.style.display = 'none';
      if (el.dashboardView) el.dashboardView.style.display = 'flex';

      if (el.adminNameText) el.adminNameText.textContent = state.currentUser.username || 'Admin';
      if (el.adminRoleBadge) el.adminRoleBadge.textContent = state.currentUser.role || 'Super Admin';

      // Load initial data and set refresh timer
      loadActiveTabData();
      if (!state.refreshInterval) {
        state.refreshInterval = setInterval(loadActiveTabData, 15000);
      }
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const username = el.usernameInput?.value.trim() || 'superadmin';
    const password = el.passwordInput?.value || '';

    if (!password) {
      showLoginError('Please enter the administrator password.');
      return;
    }

    if (el.loginBtn) el.loginBtn.disabled = true;
    if (el.loginError) el.loginError.style.display = 'none';

    try {
      const res = await fetch(`${API_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && data.token) {
        state.token = data.token;
        state.currentUser = data.user || { username, role: 'super_admin' };
        localStorage.setItem('omaglee_admin_token', state.token);
        localStorage.setItem('omaglee_admin_user', JSON.stringify(state.currentUser));
        updateAuthView();
      } else {
        showLoginError(data.message || 'Invalid administrator credentials.');
      }
    } catch {
      showLoginError('Connection to admin backend failed.');
    } finally {
      if (el.loginBtn) el.loginBtn.disabled = false;
    }
  }

  function handleLogout() {
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('omaglee_admin_token');
    localStorage.removeItem('omaglee_admin_user');
    updateAuthView();
  }

  function showLoginError(msg) {
    if (!el.loginError) return;
    el.loginError.textContent = msg;
    el.loginError.style.display = 'block';
  }

  // 4. Tab Navigation
  function switchTab(tabName) {
    state.activeTab = tabName;

    el.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    el.tabPanes.forEach(pane => {
      pane.style.display = pane.id === `tab-${tabName}` ? 'block' : 'none';
    });

    if (el.pageTitle) {
      const titles = {
        'overview': 'Dashboard Overview',
        'users': 'User Management & Sessions',
        'reports': 'Abuse Reports Moderation',
        'bans': 'Active Bans & Suspensions',
        'matches': 'Live WebRTC Matches',
        'system-health': 'System Health Diagnostics',
        'settings': 'Platform Configuration',
        'abuse-monitoring': 'Abuse & Anomaly Monitoring',
        'audit-logs': 'Administrator Audit Trail'
      };
      el.pageTitle.textContent = titles[tabName] || 'Admin Dashboard';
    }

    loadActiveTabData();
  }

  function loadActiveTabData() {
    switch (state.activeTab) {
      case 'overview':
        fetchOverview();
        break;
      case 'users':
        fetchUsers();
        break;
      case 'reports':
        fetchReports();
        break;
      case 'bans':
        fetchBans();
        break;
      case 'matches':
        fetchMatches();
        break;
      case 'system-health':
        fetchSystemHealth();
        break;
      case 'settings':
        fetchSettings();
        break;
      case 'abuse-monitoring':
        fetchAbuseMonitoring();
        break;
      case 'audit-logs':
        fetchAuditLogs();
        break;
    }
  }

  // 5. Data Fetchers & Renderers

  // Tab 1: Overview
  async function fetchOverview() {
    try {
      const res = await fetch(`${API_URL}/admin/overview`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const m = data.overview || data;

      setMetric('m-active-sessions', m.activeSessions ?? 0);
      setMetric('m-active-matches', m.activeMatches ?? 0);
      setMetric('m-waiting-queue', m.waitingQueue ?? 0);
      setMetric('m-pending-reports', m.pendingReports ?? 0);
      setMetric('m-under-review', m.underReviewReports ?? 0);
      setMetric('m-resolved-reports', m.resolvedReports ?? 0);
      setMetric('m-active-bans', m.activeBans ?? 0);
      setMetric('m-error-rate', `${m.errorRatePercent ?? 0}%`);
      setMetric('m-total-requests', (m.totalApiRequests ?? 0).toLocaleString());

      const maintBadge = document.getElementById('m-maintenance-badge');
      if (maintBadge) {
        maintBadge.textContent = m.maintenanceMode ? 'ACTIVE' : 'NORMAL';
        maintBadge.className = m.maintenanceMode ? 'badge badge-danger' : 'badge badge-success';
      }
    } catch (err) {
      console.warn('Overview fetch error:', err);
    }
  }

  function setMetric(id, val) {
    const elMetric = document.getElementById(id);
    if (elMetric) elMetric.textContent = val;
  }

  // Tab 2: Users
  async function fetchUsers() {
    const tableBody = document.getElementById('users-table-body');
    if (!tableBody) return;

    try {
      const query = new URLSearchParams();
      if (state.usersSearch) query.append('search', state.usersSearch);
      if (state.usersFilter !== 'all') query.append('status', state.usersFilter);

      const res = await fetch(`${API_URL}/admin/users?${query.toString()}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const users = data.users || [];

      if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No active or matching users found.</td></tr>';
        return;
      }

      tableBody.innerHTML = users.map(u => {
        const isBanned = u.isBanned;
        const isRestricted = u.isRestricted;
        let statusBadge = '<span class="badge badge-success">Active</span>';
        if (isBanned) statusBadge = '<span class="badge badge-danger">Banned</span>';
        else if (isRestricted) statusBadge = '<span class="badge badge-warning">Restricted</span>';

        return `
          <tr>
            <td><code>${u.maskedSessionUuid || u.sessionUuid}</code></td>
            <td>${statusBadge}</td>
            <td><code>${u.maskedIpAddress || 'Hidden'}</code></td>
            <td>${u.activeMatchId ? `<code>${u.activeMatchId.substring(0, 8)}...</code>` : '<span class="text-muted">Idle</span>'}</td>
            <td>${u.reportsCount > 0 ? `<span class="badge badge-warning">${u.reportsCount}</span>` : '0'}</td>
            <td>${formatTimeAgo(u.lastSeenAt)}</td>
            <td>
              <div class="table-actions">
                <button class="action-btn ${isRestricted ? 'action-btn-success' : 'action-btn-warning'}" onclick="window.omagleeAdmin.toggleRestrict('${u.sessionUuid}', ${!isRestricted})">
                  ${isRestricted ? 'Unrestrict' : 'Restrict'}
                </button>
                ${!isBanned ? `
                  <button class="action-btn action-btn-danger" onclick="window.omagleeAdmin.openBanModalForUser('${u.sessionUuid}')">
                    Ban
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Users fetch error:', err);
    }
  }

  // Tab 3: Reports
  async function fetchReports() {
    const tableBody = document.getElementById('reports-table-body');
    if (!tableBody) return;

    try {
      const query = state.reportsFilter !== 'all' ? `?status=${state.reportsFilter}` : '';
      const res = await fetch(`${API_URL}/admin/reports${query}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const reports = data.reports || [];

      if (reports.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No reports matching current filter.</td></tr>';
        return;
      }

      tableBody.innerHTML = reports.map(r => {
        const statusColors = {
          'pending': 'badge-warning',
          'under_review': 'badge-info',
          'resolved': 'badge-success',
          'dismissed': 'badge-secondary'
        };

        return `
          <tr>
            <td><strong>${formatReason(r.reason)}</strong><div class="text-muted text-xs">${r.description || 'No description'}</div></td>
            <td><span class="badge ${statusColors[r.status] || 'badge-secondary'}">${r.status.toUpperCase()}</span></td>
            <td><code>${r.reporterSessionUuid ? r.reporterSessionUuid.substring(0, 8) + '...' : 'Unknown'}</code></td>
            <td><code>${r.reportedSessionUuid ? r.reportedSessionUuid.substring(0, 8) + '...' : 'Unknown'}</code></td>
            <td>${formatDate(r.createdAt)}</td>
            <td>
              <button class="action-btn action-btn-primary" onclick="window.omagleeAdmin.openReviewReportModal('${r.id}')">
                Review
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Cache reports in window for modal lookup
      window._cachedReports = reports;
    } catch (err) {
      console.warn('Reports fetch error:', err);
    }
  }

  // Tab 4: Bans
  async function fetchBans() {
    const tableBody = document.getElementById('bans-table-body');
    if (!tableBody) return;

    try {
      const res = await fetch(`${API_URL}/admin/bans`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const bans = data.bans || [];

      if (bans.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No active suspensions or bans found.</td></tr>';
        return;
      }

      tableBody.innerHTML = bans.map(b => {
        const isActive = b.status === 'active';
        return `
          <tr>
            <td><code>${b.subjectSessionUuid ? b.subjectSessionUuid.substring(0, 12) + '...' : 'Unknown'}</code></td>
            <td><strong>${b.reason}</strong></td>
            <td><span class="badge ${b.banType === 'permanent' ? 'badge-danger' : 'badge-warning'}">${b.banType.toUpperCase()}</span></td>
            <td>${formatDate(b.startsAt)}</td>
            <td>${b.expiresAt ? formatDate(b.expiresAt) : 'Never (Permanent)'}</td>
            <td>
              ${isActive ? `
                <button class="action-btn action-btn-danger" onclick="window.omagleeAdmin.revokeBan('${b.id}')">
                  Revoke Ban
                </button>
              ` : '<span class="text-muted">Revoked</span>'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Bans fetch error:', err);
    }
  }

  // Tab 5: Matches
  async function fetchMatches() {
    const tableBody = document.getElementById('matches-table-body');
    if (!tableBody) return;

    try {
      const query = state.matchesFilter !== 'all' ? `?status=${state.matchesFilter}` : '';
      const res = await fetch(`${API_URL}/admin/matches${query}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const matches = data.matches || [];

      if (matches.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No matching sessions found.</td></tr>';
        return;
      }

      tableBody.innerHTML = matches.map(m => {
        const isLive = m.status === 'connected';
        return `
          <tr>
            <td><code>${m.matchId.substring(0, 10)}...</code></td>
            <td><span class="badge ${isLive ? 'badge-success' : 'badge-secondary'}">${m.status.toUpperCase()}</span></td>
            <td><code>${m.participantAId?.substring(0, 8)}</code> &harr; <code>${m.participantBId?.substring(0, 8)}</code></td>
            <td>${m.durationSeconds ? `${m.durationSeconds}s` : '0s'}</td>
            <td>${m.messageCount ?? 0}</td>
            <td>${m.endedReason ? formatReason(m.endedReason) : (isLive ? '<span class="text-emerald">Live</span>' : '-')}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.warn('Matches fetch error:', err);
    }
  }

  // Tab 6: System Health
  async function fetchSystemHealth() {
    try {
      const res = await fetch(`${API_URL}/admin/system-health`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const c = data.components || {};

      // DB
      if (c.database) {
        document.getElementById('db-status').textContent = c.database.status.toUpperCase();
        document.getElementById('db-status').className = `badge ${c.database.connected ? 'badge-success' : 'badge-danger'}`;
        document.getElementById('db-ping').textContent = `${c.database.pingMs ?? 0} ms`;
        document.getElementById('db-host').textContent = `${c.database.host}/${c.database.database}`;
      }
      // Reverb / WebSocket
      if (c.reverb) {
        document.getElementById('reverb-status').textContent = c.reverb.status.toUpperCase();
        document.getElementById('reverb-status').className = `badge ${c.reverb.status === 'healthy' ? 'badge-success' : 'badge-warning'}`;
        document.getElementById('reverb-port').textContent = `${c.reverb.host}:${c.reverb.port}`;
        document.getElementById('reverb-rooms').textContent = c.reverb.activeRooms ?? 0;
      }
      // TURN Relay
      if (c.turnRelay) {
        document.getElementById('turn-status').textContent = c.turnRelay.status.toUpperCase();
        document.getElementById('turn-status').className = `badge ${c.turnRelay.status === 'operational' ? 'badge-success' : 'badge-warning'}`;
        document.getElementById('turn-ports').textContent = `${c.turnRelay.port} / ${c.turnRelay.tlsPort} (TLS)`;
      }
      // Node Server
      if (c.server) {
        document.getElementById('srv-status').textContent = c.server.status.toUpperCase();
        document.getElementById('srv-status').className = 'badge badge-success';
        document.getElementById('srv-uptime').textContent = `${Math.floor((c.server.uptimeSeconds ?? 0) / 60)} mins`;
        document.getElementById('srv-memory').textContent = `${c.server.memoryRssMb ?? 0} MB (RSS)`;
      }
    } catch (err) {
      console.warn('Health fetch error:', err);
    }
  }

  // Tab 7: App Settings
  async function fetchSettings() {
    try {
      const res = await fetch(`${API_URL}/admin/settings`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const s = data.settings || {};

      const setVal = (id, val) => {
        const inp = document.getElementById(id);
        if (inp) inp.value = val;
      };
      const setCheck = (id, val) => {
        const chk = document.getElementById(id);
        if (chk) chk.checked = Boolean(val);
      };

      setVal('cfg-queue-timeout', s.queueTimeoutSeconds ?? 60);
      setVal('cfg-session-inactivity', s.sessionInactivityMinutes ?? 120);
      setVal('cfg-autoban-reports', s.maxReportsBeforeAutoBan ?? 3);
      setVal('cfg-rate-limit', s.rateLimitMaxRequests ?? 120);
      setCheck('cfg-force-turn', s.forceTurnRelayOnly);
      setCheck('cfg-maintenance', s.maintenanceMode);
    } catch (err) {
      console.warn('Settings fetch error:', err);
    }
  }

  async function handleSaveSettings(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('save-settings-btn');
    if (btn) btn.disabled = true;

    const payload = {
      queueTimeoutSeconds: Number(document.getElementById('cfg-queue-timeout')?.value || 60),
      sessionInactivityMinutes: Number(document.getElementById('cfg-session-inactivity')?.value || 120),
      maxReportsBeforeAutoBan: Number(document.getElementById('cfg-autoban-reports')?.value || 3),
      rateLimitMaxRequests: Number(document.getElementById('cfg-rate-limit')?.value || 120),
      forceTurnRelayOnly: Boolean(document.getElementById('cfg-force-turn')?.checked),
      maintenanceMode: Boolean(document.getElementById('cfg-maintenance')?.checked)
    };

    try {
      const res = await fetch(`${API_URL}/admin/settings`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('Platform settings saved successfully.');
      } else {
        alert('Failed to save settings.');
      }
    } catch {
      alert('Error updating settings.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Tab 8: Abuse Monitoring
  async function fetchAbuseMonitoring() {
    try {
      const res = await fetch(`${API_URL}/admin/abuse-monitoring`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();

      // Repeat Reported Users
      const repeatUsersList = document.getElementById('repeat-users-list');
      if (repeatUsersList) {
        const users = data.repeatReportedUsers || [];
        repeatUsersList.innerHTML = users.length ? users.map(u => `
          <div class="user-item">
            <div>
              <strong>${u.maskedSessionUuid}</strong>
              <div class="text-xs text-muted">Total Reports: ${u.reportCount}</div>
            </div>
            <div>
              <span class="badge ${u.isBanned ? 'badge-danger' : 'badge-warning'}">
                ${u.isBanned ? 'Banned' : 'Flagged'}
              </span>
            </div>
          </div>
        `).join('') : '<p class="text-muted text-sm">No repeat reported users detected.</p>';
      }

      // Suspicious Alerts
      const alertsList = document.getElementById('suspicious-alerts-list');
      if (alertsList) {
        const alerts = data.suspiciousAlerts || [];
        alertsList.innerHTML = alerts.length ? alerts.map(a => `
          <div class="alert-box alert-${a.severity || 'warning'}">
            <div class="alert-content">
              <h4>${a.title}</h4>
              <p>${a.description}</p>
            </div>
            <span class="badge badge-warning">${a.count} events</span>
          </div>
        `).join('') : '<p class="text-muted text-sm">No critical abuse alerts at this time.</p>';
      }
    } catch (err) {
      console.warn('Abuse monitoring error:', err);
    }
  }

  // Tab 9: Audit Logs
  async function fetchAuditLogs() {
    const tableBody = document.getElementById('audit-table-body');
    if (!tableBody) return;

    try {
      const res = await fetch(`${API_URL}/admin/audit-logs`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const logs = data.auditLogs || [];

      if (logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No audit logs recorded yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = logs.map(l => `
        <tr>
          <td><strong>${l.action}</strong></td>
          <td><code>${l.actorType}:${l.actorId}</code></td>
          <td>${l.targetType ? `<code>${l.targetType}:${l.targetId}</code>` : '-'}</td>
          <td>${formatDate(l.createdAt)}</td>
          <td><pre class="json-preview">${l.metadata ? JSON.stringify(l.metadata) : '{}'}</pre></td>
        </tr>
      `).join('');
    } catch (err) {
      console.warn('Audit logs fetch error:', err);
    }
  }

  // 6. Moderation Actions (Ban, Restrict, Review Report)
  async function toggleRestrict(sessionUuid, shouldRestrict) {
    try {
      const res = await fetch(`${API_URL}/admin/users/${sessionUuid}/restrict`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ isRestricted: shouldRestrict })
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch {
      alert('Failed to update user restriction.');
    }
  }

  async function revokeBan(banId) {
    if (!confirm('Are you sure you want to revoke this ban?')) return;
    try {
      const res = await fetch(`${API_URL}/admin/bans/${banId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        fetchBans();
      }
    } catch {
      alert('Failed to revoke ban.');
    }
  }

  function openReviewReportModal(reportId) {
    const report = (window._cachedReports || []).find(r => r.id === reportId);
    if (!report || !el.reviewModal) return;

    state.activeReport = report;
    document.getElementById('modal-report-reason').textContent = formatReason(report.reason);
    document.getElementById('modal-report-desc').textContent = report.description || 'No additional details provided.';
    document.getElementById('modal-reported-user').textContent = report.reportedSessionUuid || 'Unknown';
    el.reviewModal.style.display = 'flex';
  }

  async function resolveReport(action) {
    if (!state.activeReport) return;

    try {
      let status = 'resolved';
      if (action === 'dismiss') status = 'dismissed';
      if (action === 'review') status = 'under_review';

      await fetch(`${API_URL}/admin/reports/${state.activeReport.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          status,
          resolution: action === 'dismiss' ? 'Dismissed by moderator' : 'Resolved after review'
        })
      });

      // If action is ban, issue punitive ban
      if (action === 'ban' && state.activeReport.reportedSessionUuid) {
        await fetch(`${API_URL}/admin/bans`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            subjectSessionUuid: state.activeReport.reportedSessionUuid,
            reason: `Banned following report: ${state.activeReport.reason}`,
            banType: 'temporary',
            durationHours: 24,
            reportId: state.activeReport.id
          })
        });
      }

      if (el.reviewModal) el.reviewModal.style.display = 'none';
      state.activeReport = null;
      fetchReports();
    } catch {
      alert('Failed to update report status.');
    }
  }

  function openBanModalForUser(sessionUuid) {
    if (!el.createBanModal) return;
    const inp = document.getElementById('ban-session-uuid');
    if (inp) inp.value = sessionUuid || '';
    el.createBanModal.style.display = 'flex';
  }

  async function handleCreateBan(e) {
    if (e) e.preventDefault();
    const sessionUuid = document.getElementById('ban-session-uuid')?.value.trim();
    const reason = document.getElementById('ban-reason')?.value.trim() || 'Terms Violation';
    const banType = document.getElementById('ban-type')?.value || 'temporary';
    const durationHours = Number(document.getElementById('ban-duration')?.value || 24);

    if (!sessionUuid) {
      alert('Session UUID is required.');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/admin/bans`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          subjectSessionUuid: sessionUuid,
          reason,
          banType,
          durationHours
        })
      });

      if (res.ok) {
        if (el.createBanModal) el.createBanModal.style.display = 'none';
        fetchBans();
      } else {
        alert('Failed to create ban.');
      }
    } catch {
      alert('Error creating ban.');
    }
  }

  // 7. Formatters & Utilities
  function formatReason(reason) {
    if (!reason) return 'General';
    return reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const diff = Math.floor((Date.now() - (typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp)) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  // 8. Event Setup
  function setupEvents() {
    if (el.loginForm) el.loginForm.addEventListener('submit', handleLogin);
    if (el.logoutBtn) el.logoutBtn.addEventListener('click', handleLogout);
    if (el.refreshBtn) el.refreshBtn.addEventListener('click', loadActiveTabData);

    // Nav tabs
    el.navItems.forEach(item => {
      item.addEventListener('click', () => switchTab(item.dataset.tab));
    });

    // Modals
    if (el.closeReviewBtn) el.closeReviewBtn.addEventListener('click', () => (el.reviewModal.style.display = 'none'));
    if (el.closeCreateBanBtn) el.closeCreateBanBtn.addEventListener('click', () => (el.createBanModal.style.display = 'none'));
    if (el.openCreateBanBtn) el.openCreateBanBtn.addEventListener('click', () => openBanModalForUser(''));
    if (el.createBanForm) el.createBanForm.addEventListener('submit', handleCreateBan);

    // Search & Filter listeners
    if (el.userSearchInput) {
      el.userSearchInput.addEventListener('input', (e) => {
        state.usersSearch = e.target.value.trim();
        fetchUsers();
      });
    }
    if (el.userStatusSelect) {
      el.userStatusSelect.addEventListener('change', (e) => {
        state.usersFilter = e.target.value;
        fetchUsers();
      });
    }
    if (el.reportFilterSelect) {
      el.reportFilterSelect.addEventListener('change', (e) => {
        state.reportsFilter = e.target.value;
        fetchReports();
      });
    }
    if (el.matchFilterSelect) {
      el.matchFilterSelect.addEventListener('change', (e) => {
        state.matchesFilter = e.target.value;
        fetchMatches();
      });
    }

    // Settings
    if (el.settingsForm) el.settingsForm.addEventListener('submit', handleSaveSettings);
  }

  // Expose global methods for inline HTML onclick handlers
  window.omagleeAdmin = {
    toggleRestrict,
    revokeBan,
    openReviewReportModal,
    openBanModalForUser,
    resolveReport
  };

  // 9. Init on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEvents();
    updateAuthView();
  });
})();
