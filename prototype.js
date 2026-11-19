'use strict';

const shell = document.querySelector('#shell');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const endpoint = '127.0.0.1:41377';
const pairExample = '4821-512903';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M11 19h2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-4 3 2 4-4 6 5"/>',
  history: '<path d="M4 5v5h5M4.6 9a8 8 0 1 1 .6 8M12 8v4l3 2"/>',
  shield: '<path d="M12 22s7-4 7-10V5l-7-3-7 3v7c0 6 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 1 1 4.6 2.5c-1 .7-1.8 1.2-1.8 2.5M12 17h.01"/>',
  settings: '<path d="m10 3-.5 2.5-2 .9-2.3-1.1-2 3.4 1.9 1.8v2.9l-1.9 1.8 2 3.4 2.3-1.1 2 .9.5 2.6h4l.5-2.6 2-.9 2.3 1.1 2-3.4-1.9-1.8v-2.9l1.9-1.8-2-3.4-2.3 1.1-2-.9L14 3z"/><circle cx="12" cy="12" r="2.5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  terminal: '<path d="m5 6 5 6-5 6m8 0h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l4-4a4 4 0 0 0-5.7-5.7L12 6m2 4.5a4 4 0 0 0-5.7 0l-4 4a4 4 0 0 0 5.7 5.7L12 18"/>',
  unlink: '<path d="m9 14-1 1a3 3 0 0 0 4 4l3-3a3 3 0 0 0 0-4m0-2 1-1a3 3 0 0 0-4-4L9 8a3 3 0 0 0 0 4M4 3l16 18"/>',
  tray: '<path d="M5 13h4l2 3h2l2-3h4l-2-8H7l-2 8Zm0 0-2 5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1l-2-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  refresh: '<path d="M20 4v5h-5m5 0A8 8 0 0 0 6 6m-2 14v-5h5m-5 0a8 8 0 0 0 14 3"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  inbox: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  laptop: '<path d="M6 16V5h12v11M3 16h18l-1 3H4z"/>',
  report: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>'
};

const devices = [
  { id: 'pixel-8-personal', name: 'Pixel 8', kind: 'solo' },
  { id: 'pixel-8a-casey', name: 'Pixel 8a', kind: 'solo' },
  { id: 'qa-pixel8a-07', name: 'Checkout lab · Pixel 8a', kind: 'corporate' },
  { id: 'qa-xcover6-12', name: 'Retail lab · Galaxy XCover', kind: 'corporate', failure: -32017 }
];

const corporateFailures = {
  '-32014': ['Access revoked', 'Your access was revoked by your administrator.', 'Ask IT to review the revocation before connecting again.'],
  '-32015': ['Corporate token invalid', 'The corporate identity token could not be verified.', 'Sign in through SSO to request a fresh identity token.'],
  '-32016': ['Corporate session expired', 'Your corporate session expired. Sign in via SSO to resume.', 'SSO can rotate the daemon’s credential while existing sessions keep running.'],
  '-32017': ['No device grant', 'You don’t have access to this device. Request a grant from your IT admin.', 'Ask IT to verify your device grant, then try connecting again.'],
  '-32018': ['Device policy blocked debugging', 'Debugging is restricted by your organization’s device policy.', 'Ask IT to review Android management policy.'],
  '-32025': ['Corporate session time limit reached', 'This debugging session reached its organization’s time limit.', 'Reconnect to start a new session and reauthenticate. Sign in again if your credential needs refreshing.'],
  '-32026': ['Session ended on the phone', 'The phone ended this debugging session.', 'Choose the device to start another connection.']
};

const scenarios = [
  ['live', 'Solo debugging', 'Local ADB attached through an encrypted relay.', 'terminal'],
  ['pair', 'Pair a phone', 'Ten digits and automatic key pinning.', 'link'],
  ['corporate', 'Corporate sign-in', 'Browser SSO and granted-device presence.', 'shield'],
  ['no-grant', 'Missing grant · −32017', 'A corporate user requests device access.', 'lock'],
  ['blocked', 'MDM blocked · −32018', 'Review the typed contract fixture.', 'lock'],
  ['revoked', 'Access revoked · −32014', 'An administrator has revoked access.', 'shield'],
  ['token-invalid', 'Invalid token · −32015', 'Verification failed. Sign in again.', 'shield'],
  ['token-expired', 'Expired token · −32016', 'Recover using the SSO preview.', 'shield'],
  ['session-cap', 'Session time limit', 'Authoritative deadline fixture for the five-minute warning.', 'history'],
  ['session-expired', 'Corporate session expired · −32025', 'Reconnect after the policy cap.', 'history'],
  ['peer-closed', 'Session ended on the phone · −32026', 'Show a terminal peer close without retry.', 'phone'],
  ['token-refresh', 'Refresh a live session', 'Rotate the identity token without dropping ADB.', 'shield'],
  ['presence', 'Corporate presence', 'Fresh granted-device availability.', 'phone'],
  ['presence-stale', 'Stale corporate presence', 'Expired snapshot displays Last seen unknown.', 'phone'],
  ['wireless', 'Android system pairing', 'Pair through Setu with an optional port.', 'link'],
  ['wireless-failed', 'Android pairing failed · −32023', 'Review the recovery for a rejected code.', 'phone'],
  ['wireless-unsupported', 'Older phone agent · −32024', 'Prompt for a phone-side Setu update.', 'phone'],
  ['cancel', 'Cancel a pending connection', 'Cancel only the selected daemon request.', 'refresh'],
  ['rejoin', 'Interrupted network path', 'Explore each stage of the rejoin window.', 'refresh'],
  ['unauthorized', 'ADB unauthorized', 'Android is waiting for its system trust prompt.', 'phone'],
  ['adb-offline', 'ADB offline', 'The local ADB host sees the endpoint as offline.', 'phone'],
  ['direct', 'Direct LAN', 'Compare verified transport and operation-level audit.', 'monitor'],
  ['audit', 'Audit integrity', 'Verified, unverified, and tampered results.', 'report'],
  ['doctor', 'Diagnostics', 'Explore local ADB, relay, and audit checks.', 'settings']
];

const checks = [
  ['adb', 'Android Debug Bridge', 'Platform-Tools executable found on PATH.', 'fail', 'ADB executable was not found on PATH.', 'Install Android SDK Platform-Tools and add its directory to PATH.'],
  ['state', 'State directory', 'Local Setu state directory is writable.', 'ok', '', ''],
  ['paired_devices', 'Paired devices', 'Local paired-device registry is readable.', 'ok', '', ''],
  ['proxy_env', 'Proxy environment', 'No proxy environment overrides detected.', 'warn', 'The proxy settings need review.', 'Review HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and NO_PROXY. Credentials are redacted.'],
  ['relay_dns', 'Relay DNS', 'The configured relay name resolves.', 'ok', '', ''],
  ['relay_reach', 'Relay reachability', 'The configured relay accepts a connection.', 'fail', 'The relay could not be reached from this computer.', 'Verify the relay URL, outbound firewall, HTTP CONNECT proxy and leaf certificate pin.'],
  ['audit_log', 'Audit log', 'The local log is present and its anchor verifies.', 'warn', 'The audit anchor key could not be read.', 'Ask IT for the configured anchor key and verify file permissions before trusting the report.']
];

const labels = { none: 'No local device', device: 'device', unauthorized: 'unauthorized', offline: 'offline' };
const navItems = [['workspace', 'grid', 'Workspace'], ['devices', 'phone', 'Devices'], ['audit', 'report', 'Audit log'], ['doctor', 'terminal', 'Diagnostics'], ['settings', 'settings', 'Settings']];
const state = {
  mode: 'solo', view: 'workspace', session: null, error: null, sso: false, rejoin: '', cap: false, stagePreview: false,
  audit: 'verified', diagnostic: 'healthy', paired: new Set(['pixel-8-personal']), nicknames: {}, settings: { relay: '', pin: '', proxy: '', label: '' }, presence: null, pending: null
};

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name, size = 18) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const button = (action, label, css = '', symbol = '', value = '') => `<button type="button" class="button ${css}" data-action="${action}"${value !== '' ? ` data-value="${safe(value)}"` : ''}>${symbol ? icon(symbol) : ''}${safe(label)}</button>`;
const status = (label, theme = 'neutral') => `<span class="status ${theme}"><span aria-hidden="true"></span>${safe(label)}</span>`;
const deviceName = device => state.nicknames[device.id] || device.name;
const workspaceName = () => state.mode === 'corporate' ? 'Northstar QA' : 'Personal workspace';
const pairedDevices = () => state.mode === 'corporate'
  ? (state.presence?.rows.map(entry => devices.find(device => device.id === entry.device_id) || { id: entry.device_id, name: entry.device_id, kind: 'corporate' })
    ?? (hasDesktopRpc ? [] : devices.filter(device => device.kind === 'corporate')))
  : hasDesktopRpc ? (state.soloRows || []).map(row => ({id:row.id, name:row.id,kind:'solo'})) : devices.filter(device => device.kind === 'solo' && state.paired.has(device.id));
const seen = id => {
  const row = state.presence?.rows.find(item => item.device_id === id);
  if (typeof row?.online !== 'boolean' || performance.now() - state.presence.at >= 60000) return 'Last seen unknown';
  return row.online ? 'Online' : 'Offline';
};
const currentDevice = () => state.session && (devices.find(device => device.id === state.session.id) || { id: state.session.id, name: state.session.id });
const isAttached = () => state.session?.adb === 'device';
const attachCommand = () => `adb connect ${state.session?.addr || endpoint}`;

function heading(title, subtitle, actions = '') {
  return `<header class="page-heading"><div><h1 tabindex="-1">${safe(title)}</h1><p>${safe(subtitle)}</p></div>${actions ? `<div class="button-row">${actions}</div>` : ''}</header>`;
}

function railButton([value, symbol, title]) {
  const current = state.view === value;
  return `<button type="button" data-action="nav" data-value="${value}" class="nav-link${current ? ' active' : ''}"${current ? ' aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></button>`;
}

function render(focus = false) {
  if (state.inTray) {
    shell.innerHTML = `<main id="main" class="center-stage" tabindex="-1"><section class="card tray-page"><div class="feature-icon">${icon('tray', 25)}</div>
      <h1 tabindex="-1">Setu is in the tray</h1><p>${status('Application integration preview')}</p>
      <p class="muted">The local listener stays running while the desktop window is hidden.</p>
      <div class="button-row">${button('restore', 'Restore workspace', 'primary', 'monitor')}${button('disconnect', 'Disconnect', 'secondary', 'unlink')}</div></section></main>`;
    if (focus) shell.querySelector('h1').focus();
    return;
  }
  const view = { workspace: workspacePage, devices: devicesPage, audit: auditPage, doctor: doctorPage, settings: settingsPage }[state.view];
  shell.innerHTML = `<aside class="rail">
    <button type="button" class="workspace-picker" data-action="mode" aria-label="Switch workspace">
      <span class="workspace-glyph">${icon(state.mode === 'corporate' ? 'shield' : 'laptop', 20)}</span>
      <span><strong>${workspaceName()}</strong><small>${state.mode === 'corporate' ? 'Corporate mode' : 'Solo mode'}</small></span>${icon('down', 15)}
    </button>
    <nav class="rail-nav" aria-label="Workspace navigation">${navItems.slice(0, 3).map(railButton).join('')}</nav>
    <nav class="rail-tools" aria-label="Support and preferences">${navItems.slice(3).map(railButton).join('')}</nav>
  </aside><main id="main" class="main-pane" tabindex="-1">
    <div class="main-inner">${view()}</div>
    <footer class="app-status"><span>${status(hasDesktopRpc ? 'Desktop adapter supplied' : 'Offline fixtures')}</span><span>Setu-SDK v1.1.0 · 921aded</span></footer>
  </main>`;
  if (focus) shell.querySelector('h1').focus();
}

function transport() {
  if (state.rejoin === 'lost') return 'Path unavailable';
  if (state.session?.path === 'lan') return 'Direct LAN';
  return ({'relay-wss':'Encrypted Relay WSS', 'relay-ws':'Relay WS', 'relay-tcp':'Relay TCP'})[state.session?.path] || (state.session ? 'Path unknown' : '—');
}

function auditScope() {
  const wire = state.session?.wire;
  if (wire === 'tcpip') return 'Operation-level';
  if (wire === 'tls') return 'Session-level';
  return '—';
}

function signalStrip() {
  const adb = state.session?.adb || 'none';
  return `<div class="signal-strip" aria-label="Session status">
    <div><small>TRANSPORT PATH</small><strong>${transport()}</strong></div>
    <div><small>LOCAL ENDPOINT</small><code>${state.session ? safe(state.session.addr) : '—'}</code></div>
    <div><small>LOCAL ADB HOST</small>${status(labels[adb], adb === 'device' ? 'good' : adb === 'none' ? 'neutral' : 'warning')}</div>
    <div><small>AUDIT SCOPE</small><strong>${auditScope()}</strong></div>
  </div>`;
}

function corporateIssue(error = state.error) {
  const [title, message, fix] = corporateFailures[error];
  const recovering = error === -32015 || error === -32016;
  return `<section class="card standard-card error-card">
    <div class="feature-icon">${icon('shield', 25)}</div>
    <h2>${title} <code>${error}</code></h2><p><strong>${message}</strong></p><p class="muted">${fix}</p>${error === -32026 && state.peerReason ? `<p class="hint">Reason from the phone: <code>${safe(state.peerReason)}</code></p>` : ''}
    <div class="button-row">${recovering ? button('sso', 'Sign in via SSO', 'primary', 'arrow') : [-32025, -32026].includes(error) ? button('recover-session', 'Reconnect', 'secondary', 'refresh') : button('admin', 'Contact IT administrator', 'secondary', 'help')}
    ${error === -32017 ? button('clear-error', 'Back to devices', 'quiet') : ''}</div>
  </section>`;
}

function corporateSignIn() {
  return `<section class="card standard-card identity-card"><div class="feature-icon">${icon('shield', 24)}</div>
    <h2>Sign in with your organization</h2>
    <p class="muted">The browser sign-in adapter hands the file-backed Ed25519 public key from <code>identity.public_key</code> to your organization’s token issuer. The issuer and key binding are app integration work.</p>
    ${button('sso', 'Sign in via SSO', 'primary', 'arrow')}${!hasDesktopRpc ? status('SSO fixture') : ''}</section>`;
}

function rejoinNotice() {
  if (state.rejoin === 'holding') return `<p class="notice warning banner" role="status">${icon('refresh', 18)}<span><strong>Holding session while phone reconnects.</strong> ${isAttached() ? 'Your debugger stays attached while Setu attempts to rejoin this stream.' : 'Setu is trying to restore the ADB stream.'}</span></p>`;
  if (state.rejoin === 'lost') return `<p class="notice warning banner" role="status">${icon('info', 18)}<span><strong>Phone unreachable.</strong> This stream’s rejoin window ended. Reattach the debugger when the phone is reachable.</span></p>`;
  return '';
}

function workspacePage() {
  const ready = state.mode === 'solo' || state.sso;
  const connect = ready && !state.error && !state.session && !state.pending ? button(state.mode === 'solo' ? 'pair' : 'nav', state.mode === 'solo' ? 'Pair a phone' : 'Select device', 'primary', 'plus', 'devices') : '';
  const intro = heading('Workspace', `${workspaceName()} / ${state.mode === 'solo' ? 'Solo · Local-first' : 'Corporate policy'}`, connect);
  if (state.error) return intro + corporateIssue();
  if (!ready) return intro + corporateSignIn();
  return intro + signalStrip() + (state.cap ? `<p class="notice warning banner" role="status">${icon('history', 18)}<span><strong>Corporate time limit within 5 minutes.</strong> Save your work and prepare to reconnect.</span></p>` : '') +
    (state.pending ? `<div class="notice" role="status">${state.pending.method === 'session.pair_adb' ? 'Pairing the Android debugger.' : 'Connecting to your device.'} ${button('cancel-connect', 'Cancel request', 'secondary')}</div>` : '') + rejoinNotice() + (state.stagePreview ? rejoinControls() : '') + `<div class="home-grid relay-grid">${sessionCard()}${detailsPanel()}${devicePanel()}</div>`;
}

function sessionCard() {
  const device = currentDevice();
  if (!state.session || !device) return `<section class="card session-card">
    <div class="section-header"><h2 class="eyebrow">Debug session</h2>${status('No local listener')}</div>
    <div class="empty-session"><div class="feature-icon">${icon('link', 27)}</div>
    <h3>${state.mode === 'solo' ? 'Connect to your Android phone' : 'Connect to a policy device'}</h3>
    <p class="muted">${state.mode === 'solo' ? 'Enter the ten-digit code shown by Setu on Android or select a paired device.' : 'Choose a device listed in your corporate policy.'}</p></div>
  </section>`;
  const linked = Boolean(state.session.path && state.rejoin !== 'lost');
  const reported = state.session.adb;
  return `<section class="card session-card">
    <div class="section-header"><h2 class="eyebrow">Current session</h2><div class="status-row">
      ${status('Tunnel ready', 'good')}${isAttached() ? status('ADB attached', 'good') : ''}</div></div>
    <div class="session-title"><div class="device-glyph blue">${icon('phone', 24)}</div><div><h3>${safe(deviceName(device))}</h3><p><code>${safe(device.id)}</code></p></div><span class="session-id">${safe(state.session.rpcId)}</span></div>
    <div class="topology${linked ? '' : ' interrupted'}" aria-label="Path from desktop to Android">
      <div class="topology-unit"><div class="topology-node">${icon('monitor', 24)}</div><strong>This desktop</strong><small>Local ADB</small></div>
      <div class="topology-line"><span></span></div>
      <div class="topology-unit"><div class="topology-node relay-node">${icon(linked && state.session.path === 'lan' ? 'link' : 'lock', 22)}</div><strong>${linked ? transport() : 'Transport'}</strong><small>${linked ? 'Verified stream' : 'Awaiting stream'}</small></div>
      <div class="topology-line"><span></span></div>
      <div class="topology-unit"><div class="topology-node">${icon('phone', 24)}</div><strong>${safe(deviceName(device))}</strong><small>Android host</small></div>
    </div>
    <p class="session-note">${icon(isAttached() ? 'check' : 'info', 17)}<span>${isAttached() ? '<strong>ADB host reports <code>device</code>.</strong> Your debugger is attached.' : '<strong>Local listener ready.</strong> The SDK negotiates the transport when an ADB stream opens.'}</span></p>
    ${reported === 'unauthorized' ? `<p class="notice warning">${icon('phone', 18)}<span>ADB host reports <code>unauthorized</code>. Unlock the phone and accept Android’s system debugging trust prompt, then reconnect.</span></p>` : ''}
    ${reported === 'offline' ? `<p class="notice warning">${icon('info', 18)}<span>ADB host reports <code>offline</code>. Recheck Android debugging and reconnect the local ADB endpoint.</span></p>` : ''}
    <div class="command"><span aria-hidden="true">${icon('terminal', 16)}</span><code>${safe(attachCommand())}</code>${button('copy-adb', 'Copy', 'quiet copy-command', 'copy')}</div>
    <div class="session-actions">${state.mode === 'corporate' ? button('sso', 'Refresh SSO', 'quiet', 'shield') : ''}${!isAttached() ? button('connect-adb', 'Connect ADB', 'primary', 'terminal') : ''}${button('wireless', 'Pair Android debugger', 'quiet', 'help')}${button('background', 'Move to tray', 'quiet', 'tray')}${button('disconnect', 'Disconnect', 'quiet danger', 'unlink')}</div>
  </section>`;
}

function detailsPanel() {
  const device = currentDevice();
  return `<section class="card details-card"><div class="section-header"><h2>Connection details</h2>${icon('shield', 19)}</div>
    <dl class="detail-list"><div><dt>SDK listener</dt><dd>${state.session ? '<code>listening</code>' : 'Inactive'}</dd></div>
    <div><dt>Transport</dt><dd>${transport()}</dd></div>
    <div><dt>ADB host</dt><dd><code>${labels[state.session?.adb || 'none']}</code></dd></div>
    <div><dt>Device ID</dt><dd><code>${safe(device?.id || '—')}</code></dd></div>
    <div><dt>Session audit</dt><dd>${auditScope()}</dd></div></dl><div class="details-link">${button('nav', 'Open diagnostics', 'quiet', 'terminal', 'doctor')}</div>
  </section>`;
}

function deviceRows() {
  const list = pairedDevices();
  return list.length ? `<ul class="list">${list.map(device => `<li><button type="button" class="list-row" data-action="device" data-value="${safe(device.id)}">
    <span class="row-glyph blue">${icon('phone', 19)}</span><span class="row-copy"><strong>${safe(deviceName(device))}</strong><small><code>${safe(device.id)}</code></small></span>
    ${status(device.kind === 'corporate' ? seen(device.id) : 'Paired')}${icon('chevron', 15)}</button></li>`).join('')}</ul>` : '<p class="muted inset">Paired phones will appear here after connecting.</p>';
}

function devicePanel() {
  return `<section class="card device-card"><div class="section-header"><h2>${state.mode === 'solo' ? 'Paired devices' : 'Policy devices'}</h2>${button('nav', 'View all', 'quiet small', '', 'devices')}</div>${deviceRows()}</section>`;
}

function devicesPage() {
  const corporate = state.mode === 'corporate';
  const intro = heading('Devices', corporate ? 'Northstar QA · Granted devices' : 'Local paired-device registry',
    corporate ? (state.sso ? button('refresh-presence', 'Refresh presence', 'secondary', 'refresh') : '') : button('pair', 'Pair a phone', 'primary', 'plus'));
  if (state.error) return intro + corporateIssue();
  if (corporate && !state.sso) return intro + corporateSignIn();
  return intro + `<div class="page-grid"><section class="card device-card"><div class="section-header"><h2>${corporate ? 'Policy devices' : 'Paired devices'}</h2></div>${deviceRows()}</section>
    <section class="card standard-card"><div class="feature-icon">${icon(corporate ? 'shield' : 'link', 24)}</div>
    <h2>${corporate ? 'Device access' : 'Pairing and trust'}</h2>
    <p class="muted">${corporate ? 'Current presence is shown for granted devices when the snapshot is less than 60 seconds old. Nicknames are local.' : 'A successful code exchange pins the desktop key on the phone and saves the peer on this computer. Forget removes this computer’s paired record.'}</p></section></div>`;
}

const auditEvents = [
  { ts: '2026-11-18T09:42:11Z', event: 'session_start', device: 'qa-pixel8a-07', transport: 'relay-wss', scope: 'Session-level · TLS' },
  { ts: '2026-11-18T09:20:14Z', event: 'adb_op', device: 'qa-pixel8a-07', transport: 'lan', scope: 'Operation-level · tcpip' },
  { ts: '2026-11-18T09:09:40Z', event: 'session_start', device: 'qa-pixel8a-07', transport: 'lan', scope: 'Session-level event' }
];

function auditPage() {
  const title = heading('This computer’s audit log', 'Local daemon records · Central SIEM or webhook handles organization-wide aggregation', button('report', 'Export report', 'primary', 'inbox'));
  if (state.rpcPending === 'audit') return title + '<p class="notice" role="status">Reading the local audit log…</p>';
  const chain = hasDesktopRpc ? state.liveChain : fixtureChain();
  const events = hasDesktopRpc ? state.liveEvents.slice(-30).reverse() : auditEvents;
  const integrity = {
    verified: ['Verified', 'good', 'The hash chain and signed anchor verified.'],
    unverified: ['Unverified', 'warning', 'The hash chain can be valid while the anchor or its verification key is unavailable.'],
    tampered: ['Tampered', 'critical', 'An invalid chain or anchor was detected. Preserve the files and contact your security team before relying on this report.']
  }[auditIntegrity()];
  return title +
    `<section class="card standard-card audit-anchor">
      <div class="section-header"><h2>${icon('shield', 20)} Anchor status</h2>${status(integrity[0], integrity[1])}</div>
      <p>${state.rpcError ? 'Anchor verification is unavailable.' : integrity[2]}</p><p class="hint"><code>audit.verify</code> · ${hasDesktopRpc ? 'Local daemon' : 'Offline response fixture'}</p>
      ${chain?.broken_at ? `<p class="muted">First broken record: ${safe(chain.broken_at)}.</p>` : ''}
      ${chain?.problem ? `<p class="notice warning">${safe(chain.problem)}</p>` : ''}
      ${Array.isArray(chain?.warnings) && chain.warnings.length ? `<ul>${chain.warnings.map(message => `<li>${safe(message)}</li>`).join('')}</ul>` : ''}
      ${state.rpcError ? `<p class="notice warning" role="status">${safe(state.rpcError)}</p>` : ''}
      ${!hasDesktopRpc ? `<label for="audit-result">Preview an integrity result</label><select id="audit-result" data-action="audit-result">
        ${['verified', 'unverified', 'tampered'].map(key => `<option value="${key}"${key === state.audit ? ' selected' : ''}>${key[0].toUpperCase() + key.slice(1)}</option>`).join('')}
      </select>` : ''}
    </section>
    <section class="card standard-card audit-events"><div class="section-header"><h2>Local activity</h2></div>
    <div class="scope-note"><div><strong>Operation-level · classic tcpip</strong><p>Observable ADB operations may be logged.</p></div>
      <div><strong>Session-level · Wireless Debugging TLS</strong><p>Device TLS hides individual ADB operations.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th scope="col">Time (UTC)</th><th scope="col">Event</th><th scope="col">Device ID</th><th scope="col">Audit scope</th></tr></thead>
    <tbody>${events.map(entry => `<tr><td><time datetime="${safe(entry.ts)}">${safe(String(entry.ts || '').slice(11, 19))}</time></td><td><code>${safe(entry.event)}</code></td><td><code>${safe(entry.device || '—')}</code></td><td>${safe(entry.scope || (entry.event === 'adb_op' ? 'Operation-level · tcpip' : 'Session-level event'))}</td></tr>`).join('') || `<tr><td colspan="4">${state.liveEventsError ? 'The daemon did not return audit records.' : 'No local audit records.'}</td></tr>`}</tbody></table></div></section>`;
}

function doctorPage() {
  const title = heading('Diagnostics', 'setu doctor · This computer', button('nav', 'Connection settings', 'secondary', 'settings', 'settings'));
  if (state.rpcError) return title + `<p class="notice warning" role="status">${safe(state.rpcError)}</p>`;
  if (state.rpcPending === 'doctor' || (hasDesktopRpc && !state.liveChecks)) return title + '<p class="notice" role="status">Checking local diagnostics…</p>';
  const entries = hasDesktopRpc ? state.liveChecks : doctorFixture();
  return title +
    `<section class="card standard-card"><div class="section-header doctor-head"><div><h2>Doctor checks</h2><p class="hint"><code>doctor</code> RPC · ${hasDesktopRpc ? 'Local daemon' : 'Offline response fixture'}</p></div>
      ${!hasDesktopRpc ? `<div><label for="doctor-result">Preview response</label><select id="doctor-result" data-action="doctor-result">
        <option value="healthy"${state.diagnostic === 'healthy' ? ' selected' : ''}>All checks pass</option>
        <option value="failure"${state.diagnostic === 'failure' ? ' selected' : ''}>Setup and relay issues</option>
        <option value="unconfigured"${state.diagnostic === 'unconfigured' ? ' selected' : ''}>Relay not configured</option></select></div>` : ''}</div>
    <ul class="list doctor-list">${entries.map(({ name, status: result, detail, hint }) => {
      const theme = { ok: 'good', warn: 'warning', fail: 'critical', skip: 'neutral' }[result] || 'neutral';
      return `<li><div><strong>${safe(checks.find(([id]) => id === name)?.[1] || name)}</strong> <code>${safe(name)}</code><p>${safe(detail)}</p>${result !== 'ok' && hint ? `<p class="muted">${safe(hint)}</p>` : ''}</div>${status(String(result || 'unknown').toUpperCase(), theme)}</li>`;
    }).join('')}</ul></section>`;
}

function settingsPage() {
  return heading('Settings', 'Local daemon startup configuration') +
    `<div class="page-grid"><section class="card standard-card"><div class="section-header"><h2>Relay and proxy</h2>${icon('settings', 20)}</div>
    <form data-form="settings" novalidate>
      <label for="setting-label">Computer name</label><input id="setting-label" name="label" type="text" value="${safe(state.settings.label)}" maxlength="64" autocomplete="off" aria-describedby="label-hint"><p id="label-hint" class="hint">Sent as --label at startup. The phone shows it under <strong>Connected as (unverified)</strong>.</p>
      <label for="setting-relay">Custom relay URL</label><input id="setting-relay" name="relay" type="text" value="${safe(state.settings.relay)}" placeholder="wss://relay.example.test" autocomplete="off" aria-describedby="relay-hint setting-error">
      <p id="relay-hint" class="hint">Use the administrator’s WSS/WS URL or a TCP host:port.</p>
      <label for="setting-pin">Relay certificate pin</label><input id="setting-pin" name="pin" type="text" value="${safe(state.settings.pin)}" autocomplete="off" spellcheck="false" aria-describedby="pin-hint setting-error">
      <p id="pin-hint" class="hint">SHA-256 of the leaf certificate DER, 64 hexadecimal digits with optional colon separators. Normal TLS certificate validation still applies.</p>
      <label for="setting-proxy">Corporate HTTP proxy</label><input id="setting-proxy" name="proxy" type="text" value="${safe(state.settings.proxy)}" placeholder="http://proxy.example.test:8080" autocomplete="off" aria-describedby="proxy-hint setting-error">
      <p id="proxy-hint" class="hint">HTTP CONNECT proxy URL. Enter the host and port only in this demo.</p>
      <p id="setting-error" class="error-message" role="alert" hidden></p>
      <div class="button-row"><button class="button primary" type="submit">Save preview settings</button>${button('nav', 'Open diagnostics', 'quiet', 'terminal', 'doctor')}</div>
    </form></section>
    <section class="card standard-card"><div class="feature-icon">${icon('shield', 24)}</div><h2>Apply configuration</h2>
    <p class="muted">The production app supplies these values through <code>--label</code>, <code>--relay</code>, <code>--relay-pin</code> and <code>--proxy</code> when starting the daemon. This preview stores values only while the page is open.</p></section></div>`;
}

function rejoinControls() {
  return `<div class="rejoin-controls"><label for="rejoin-stage">Rejoin stage · SDK event fixture</label><select id="rejoin-stage" data-action="rejoin-stage">
    <option value="silent"${state.rejoin === 'silent' ? ' selected' : ''}>First 10 seconds · Silent</option>
    <option value="holding"${state.rejoin === 'holding' ? ' selected' : ''}>10–90 seconds · Holding</option>
    <option value="lost"${state.rejoin === 'lost' ? ' selected' : ''}>After 90 seconds · Stream lost</option>
    <option value="restored"${state.rejoin === 'restored' ? ' selected' : ''}>New stream · Reattach ADB</option>
    </select><p class="hint">These fixtures replay path_down, path_up and path_lost. The SDK’s rejoin window starts when it detects the broken stream.</p></div>`;
}

function openDialog(title, content, wide = false) {
  dialog.className = wide ? 'wide-dialog' : '';
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title" tabindex="-1">${safe(title)}</h2>
    <button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('close', 20)}</button></header><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  (dialog.querySelector('[data-autofocus]') || dialog.querySelector('#dialog-title')).focus();
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

function scenarioButton([value, title, detail, symbol], action = 'scenario') {
  return `<button class="scenario-option" type="button" data-action="${action}" data-value="${value}"><span class="row-glyph blue">${icon(symbol, 19)}</span><span><strong>${title}</strong><small>${detail}</small></span>${icon('chevron', 15)}</button>`;
}

function pairDialog() {
  if (state.mode !== 'solo' || state.session) return;
  openDialog('Pair a phone', `<p class="muted dialog-intro">Open Setu on Android, start hosting, and enter the code shown on the phone.</p>
    <form data-form="pair" novalidate><label for="pair-code">Setu pairing code</label>
    <input id="pair-code" class="pair-code" name="code" data-autofocus inputmode="numeric" autocomplete="off" maxlength="32" aria-describedby="pair-hint pair-error" placeholder="0000-000000" required>
    <p id="pair-hint" class="hint">Demo code <code>${pairExample}</code>. The phone rotates the code after successful use or three failed attempts.</p>
    <p id="pair-error" class="error-message" role="alert" hidden></p>
    <div class="button-row dialog-actions"><button type="submit" class="button primary">Pair and connect ${icon('arrow', 17)}</button></div></form>`);
}

function deviceDialog(id) {
  const device = pairedDevices().find(item => item.id === id);
  if (!device) return;
  openDialog(deviceName(device), `<div class="device-summary"><span class="device-glyph blue">${icon('phone', 24)}</span>
    <div><strong><code>${safe(device.id)}</code></strong><p class="muted">${device.kind === 'solo' ? 'Locally paired' : seen(device.id)}</p></div></div>
    <form data-form="nickname" data-device="${safe(device.id)}"><label for="nickname">Local nickname</label>
      <input id="nickname" name="nickname" value="${safe(deviceName(device))}" maxlength="56" required>
      <div class="button-row nickname-actions"><button type="submit" class="button secondary">Save nickname</button></div></form>
    <div class="button-row dialog-actions">
    ${device.kind === 'solo' && state.session?.id !== id ? button('forget', 'Forget paired device', 'quiet danger', '', id) : ''}
    ${state.session?.id === id ? button('nav', 'View session', 'primary', 'arrow', 'workspace') : button('resume', 'Connect device', 'primary', 'link', id)}</div>`);
}

function wirelessDialog() {
  if (!state.session || state.pending) return;
  openDialog('Pair the Android debugger', `<p>On Android, keep <strong>Wireless debugging → Pair device with pairing code</strong> open. Enter its six-digit system code for this device.</p>
    <form data-form="wireless" novalidate><label for="system-code">Android system pairing code</label>
    <input id="system-code" name="code" inputmode="numeric" autocomplete="off" maxlength="6" required placeholder="000000">
    <label for="system-port">Android system pairing port (optional)</label>
    <input id="system-port" name="port" inputmode="numeric" autocomplete="off" maxlength="5" aria-describedby="port-hint">
    <p id="port-hint" class="hint">Leave empty to let the phone find it</p>
    <p id="wireless-error" class="error-message" role="alert" hidden></p>
    <div class="button-row dialog-actions"><button type="submit" class="button primary">Pair Android debugger</button></div></form>`);
}

function ssoDialog() {
  if (hasDesktopRpc && typeof window.setuDesktopStartSso === 'function') {
    void startNativeSso();
    return;
  }
  if (hasDesktopRpc) {
    openDialog('Corporate sign-in', '<p>Use your desktop app’s organization sign-in to send an updated identity token to the daemon.</p>');
    return;
  }
  openDialog('Continue in your browser', `<p>The desktop app’s native sign-in binds the Setu JWT to <code>identity.public_key</code> and applies it live through <code>auth.set_token</code>. This page never handles the token.</p>
    <div class="button-row dialog-actions">${button('close', 'Cancel', 'secondary')}${button('sso-return', 'Simulate browser SSO return', 'primary', 'arrow')}</div>`);
}

function reportDialog() {
  openDialog('Export local audit report', `<p class="muted dialog-intro">${hasDesktopRpc ? 'Download the report returned by the local daemon.' : 'The production app calls <code>audit.report</code> with the selected format. This preview downloads a fixture report locally.'}</p>
    <form data-form="report"><label for="report-format">Report format</label><select id="report-format" name="format" data-autofocus><option value="json">JSON</option><option value="csv">CSV</option><option value="html">HTML</option></select>
    <div class="button-row dialog-actions"><button type="submit" class="button primary">${icon('inbox', 17)} Download ${hasDesktopRpc ? 'local' : 'fixture'} report</button></div></form>`);
}

function announce(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

function showError(id, message, field) {
  const error = document.querySelector(`#${id}`);
  error.textContent = message;
  error.hidden = false;
  field?.setAttribute('aria-invalid', 'true');
  field?.focus();
}

function go(view) {
  closeDialog();
  state.inTray = false;
  state.view = view;
  state.rpcError = '';
  if (hasDesktopRpc && ['audit', 'doctor'].includes(view)) {
    loadSdkView(view);
    return;
  }
  render(true);
  if ((view === 'devices' && (hasDesktopRpc || !state.presence)) || (hasDesktopRpc && view === 'workspace' && state.mode === 'solo')) void refreshDirectory();
}

const outages = new Map();
let serial = 0, presenceSequence = 0, presenceTimer, deadlineTimer;

function clearPath() {
  for (const item of outages.values()) clearTimeout(item.timer);
  outages.clear();
  clearTimeout(deadlineTimer);
  state.rejoin = '';
  state.cap = false;
}

function openSession(id, adb = 'none', path = null, wire = null, result = {}) {
  clearPath();
  state.session = { id, adb, path, wire, addr: result.adb_addr || endpoint, rpcId: result.session_id || 'ses_demo_0042' };
  state.error = null;
  go('workspace');
}

function fixturePresence() {
  return [{device_id:'qa-pixel8a-07',online:true,sessions:1},{device_id:'qa-xcover6-12',online:false,sessions:0}];
}

async function refreshDirectory() {
  const mode = state.mode;
  if (mode === 'corporate' && !state.sso) return;
  if (mode === 'solo' && !hasDesktopRpc) return;
  const sequence = ++presenceSequence;
  try {
    const result = await requestSdk(mode === 'corporate' ? 'devices.presence' : 'devices.list');
    if (!Array.isArray(result?.devices)) throw Error('Unavailable');
    if (sequence !== presenceSequence || state.mode !== mode) return;
    if (mode === 'solo') state.soloRows = result.devices.filter(x => x?.paired && typeof x.id === 'string');
    else {
      state.presence = { rows: result.devices.filter(x => typeof x?.device_id === 'string' && x.device_id), at: performance.now() };
      clearTimeout(presenceTimer);
      presenceTimer = setTimeout(() => { if (['devices','workspace'].includes(state.view) && !state.inTray) render(); }, 60010);
    }
  } catch {
    if (sequence !== presenceSequence) return;
    if (mode === 'corporate' && state.presence) state.presence.at = -Infinity;
    announce('Could not refresh device availability.');
  }
  if (['devices','workspace'].includes(state.view) && !state.inTray) render();
}

// Setu JWTs never enter page script. The native host runs SSO and calls auth.set_token
// (or rewrites the --identity-file); the page only reacts to the daemon's token_updated event.
function credentialUpdated() {
  const recovering = !state.sso || [-32015,-32016].includes(state.error);
  state.sso = true;
  if ([-32015,-32016].includes(state.error)) state.error = null;
  // A background identity-file rotation must not move the user away from the current screen.
  if (recovering) go(state.session || state.error ? 'workspace' : 'devices');
  announce('Corporate credential updated. Existing sessions stay running.');
}

async function startNativeSso() {
  try {
    if (await window.setuDesktopStartSso() === false) announce('Corporate sign-in was not completed.');
  } catch {
    announce('Corporate sign-in could not complete. Try signing in again.');
  }
}

async function pendingRequest(method, params) {
  if (state.pending) return;
  const request = { method, id: 'setu-ui-' + (++serial) };
  state.pending = request;
  if (method === 'session.connect') go('workspace');
  else {
    openDialog('Pairing Android debugger', `<p>Setu is pairing over the tunnel.</p>${button('cancel-connect', 'Cancel pairing', 'secondary')}`);
    render();
  }
  try {
    const result = await requestSdk(method, params, request.id);
    if (state.pending === request) return result;
  } finally {
    if (state.pending === request) {
      state.pending = null;
      render();
    }
  }
}

async function cancelPending() {
  const request = state.pending;
  if (!request || request.cancelling) return;
  request.cancelling = true;
  try {
    const result = await requestSdk('session.cancel', { request_id: request.id });
    if (!result?.cancelled) announce('The request may already have completed.');
  } catch {
    announce('Could not cancel the pending request.');
  } finally {
    request.cancelling = false;
  }
}

async function connectDevice(params) {
  const returnView = state.view;
  try {
    const result = await pendingRequest('session.connect', params);
    if (!result) return;
    if (typeof result.device_id !== 'string' || !result.device_id || !result.session_id ||
        !/^127[.]0[.]0[.]1:[1-9][0-9]{0,4}$/.test(result.adb_addr)) throw Error('Invalid session result');
    if (params.pairing_code) {
      state.paired.add(result.device_id);
      state.pairUsed = true;
    }
    openSession(result.device_id, 'none', null, null, result);
    if (params.pairing_code) announce('Pairing succeeded. The device is saved locally.');
  } catch (error) {
    if (error?.code === -32022) { go(returnView); return announce('Connection cancelled.'); }
    if (corporateFailures[error?.code]) {
      state.error = error.code;
      state.recoverDevice = params.device_id;
      go('workspace');
    } else if (params.pairing_code) {
      pairDialog();
      const input = dialog.querySelector('#pair-code');
      if (input) showError('pair-error', error?.code === -32013 ? 'Pairing code rejected (−32013). Check the current code shown on Android.' : 'Could not connect. Check hosting and try again.', input);
    } else announce('Could not connect. Check device availability and try again.');
  }
}

function updatePathView(force = true) {
  const wasVisible = ['lost','holding'].includes(state.rejoin);
  const stages = Array.from(outages.values(), item => item.stage);
  state.rejoin = ['lost','holding','silent'].find(key => stages.includes(key)) || '';
  if ((force || wasVisible !== ['lost','holding'].includes(state.rejoin)) && state.view === 'workspace' && !state.inTray) render();
}

let resyncing = false;
const heldEvents = [];

async function resync() {
  if (resyncing) return;
  resyncing = true;
  const current = state.session;
  for (const item of outages.values()) clearTimeout(item.timer);
  outages.clear();
  updatePathView();
  try {
    const lists = [refreshDirectory()];
    if (hasDesktopRpc && current) lists.push(requestSdk('session.list').then(result => {
      if (state.session === current && Array.isArray(result?.sessions) && !result.sessions.some(item => item.session_id === current.rpcId)) {
        state.session = null;
        clearPath();
        render();
      }
    }, () => announce('Could not refresh the session list.')));
    await Promise.all(lists);
  } finally {
    // P21: events that arrived during the resync are applied only after the lists are current.
    resyncing = false;
    for (const held of heldEvents.splice(0)) receiveEvent(held);
  }
}

function receiveEvent(input) {
  if (input?.method === 'events.dropped') return void resync();
  if (resyncing) return void heldEvents.push(input);
  const event = input?.method === 'event' ? input.params : input;
  if (event?.type === 'token_updated') return credentialUpdated();
  const session = state.session;
  if (!session || event?.session !== session.rpcId) return;
  const {type, fields = {}} = event;
  if (['session_expired','peer_closed','session_down'].includes(type)) {
    state.recoverDevice = session.id;
    state.session = null;
    clearPath();
    state.peerReason = type === 'peer_closed' && typeof fields.peer_reason === 'string' ? fields.peer_reason : '';
    if (type !== 'session_down') {
      state.error = type === 'session_expired' ? -32025 : -32026;
      state.view = 'workspace';
    } else announce(fields.error ? 'The session ended unexpectedly. Choose the device to reconnect.' : 'The session ended.');
    render();
    return;
  }
  if (!['path_down','path_up','path_lost'].includes(type) || !fields.session_id) return;
  const id = fields.session_id;
  const old = outages.get(id);
  if (type === 'path_down') {
    if (old) return;
    const item = {stage:'silent'};
    outages.set(id,item);
    item.timer = setTimeout(() => {
      if (outages.get(id) !== item || state.session !== session) return;
      item.stage = 'holding';
      updatePathView();
    },10000);
  } else {
    clearTimeout(old?.timer);
    outages.delete(id);
    if (type === 'path_lost') outages.set(id, {stage:'lost'});
  }
  const oldPath = session.path;
  if (['lan','relay-tcp','relay-ws','relay-wss'].includes(fields.transport) && type !== 'path_lost') session.path = fields.transport;
  updatePathView(type !== 'path_down' || session.path !== oldPath);
}

function setSessionDeadline({session_id,expires_at} = {}) {
  if (session_id !== state.session?.rpcId || !state.session || state.mode !== 'corporate') return;
  clearTimeout(deadlineTimer);
  const deadline = Date.parse(expires_at);
  const refresh = () => {
    const remaining = deadline - Date.now();
    state.cap = remaining > 0 && remaining <= 300000;
    if (state.view === 'workspace') render();
    if (remaining > 0) deadlineTimer = setTimeout(refresh, Math.min(2147483647, state.cap ? remaining : remaining-300000));
  };
  refresh();
}

function chooseMode(mode) {
  if (state.pending) return announce('Cancel the pending request before switching workspaces.');
  if (mode !== state.mode) {
    clearPath();
    presenceSequence++;
    state.presence = null;
    state.session = null;
    state.error = null;
    state.stagePreview = false;
    state.mode = mode;
    state.sso = false;
  }
  go('workspace');
}

function runScenario(key) {
  if (!scenarios.some(([name]) => name === key)) return;
  if (state.pending) return announce('Cancel the pending request before changing scenarios.');
  clearPath();
  presenceSequence++;
  Object.assign(state,{scenario:key, mode:'solo',sso:false,session:null,error:null,stagePreview:false,inTray:false,pairUsed:false,audit:'verified',diagnostic:'healthy',presence:null});
  const error = ({'no-grant':-32017,blocked:-32018,revoked:-32014,'token-invalid':-32015,'token-expired':-32016,'session-expired':-32025,'peer-closed':-32026})[key];
  if (error || ['corporate','presence','presence-stale','session-cap','token-refresh'].includes(key)) {
    state.mode = 'corporate';
    state.sso = !['corporate','token-invalid','token-expired'].includes(key);
    state.error = error || null;
    state.recoverDevice = 'qa-pixel8a-07';
  }
  if (key === 'presence' || key === 'presence-stale') {
    state.presence = {rows:fixturePresence(),at:performance.now()-(key === 'presence-stale' ? 60000 : 0)};
    return go('devices');
  }
  if (key === 'session-cap' || key === 'token-refresh') {
    openSession('qa-pixel8a-07','device','relay-wss','tls');
    if (key === 'session-cap') setSessionDeadline({session_id:state.session.rpcId,expires_at:new Date(Date.now()+240000).toISOString()});
    return;
  }
  if (key === 'audit' || key === 'doctor') {
    if (key === 'doctor') state.diagnostic = 'failure';
    return go(key);
  }
  if (key === 'rejoin') state.stagePreview = true;
  if (['live','direct','rejoin'].includes(key)) {
    openSession('pixel-8-personal','device',key==='direct'?'lan':'relay-wss',key==='direct'?'tcpip':'tls');
    if (key==='rejoin') setRejoinStage('silent');
    return;
  }
  if (key==='unauthorized'||key==='adb-offline') return openSession('pixel-8-personal',key==='unauthorized'?'unauthorized':'offline','relay-wss','tls');
  if (key.startsWith('wireless')) {
    openSession('pixel-8a-casey');
    return wirelessDialog();
  }
  go('workspace');
  if (key === 'pair') pairDialog();
  if (key === 'cancel') void connectDevice({device_id:'pixel-8-personal'});
}

function formatPairing(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  return digits.length <= 4 ? digits : `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function parseUrl(value, protocols) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function validRelay(value) {
  if (parseUrl(value, ['wss:', 'ws:'])) return true;
  const port = value.match(/^(?:\[[\da-f:.]+\]|[\da-z.-]+):(\d{1,5})$/i)?.[1];
  return Boolean(port && Number(port) > 0 && Number(port) <= 65535 && parseUrl(`tcp://${value}`, ['tcp:']));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    announce('Command copied.');
  } catch {
    openDialog('Copy command', `<label for="copy-text">Select and copy the command</label><textarea id="copy-text" data-autofocus readonly rows="2">${safe(text)}</textarea>`);
    dialog.querySelector('textarea').select();
  }
}

function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  const integrity = auditIntegrity() === 'tampered' ? '-tampered' : '';
  link.download = `setu-${hasDesktopRpc ? 'local' : 'fixture'}-audit${integrity}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const hasDesktopRpc = typeof window.setuDesktopRpc === 'function';

function fixtureChain() {
  return { valid: state.audit !== 'tampered', records: auditEvents.length, anchor: { verified: 'verified', unverified: 'unverified', tampered: 'invalid' }[state.audit],
    broken_at: state.audit === 'tampered' ? 2 : 0, problem: state.audit === 'tampered' ? 'Fixture record hash mismatch' : '', first_seq: 1, starts_at_genesis: true,
    warnings: state.audit === 'unverified' ? ['The anchor signature key is unavailable in this fixture.'] : [] };
}

function doctorFixture() {
  const entries = state.diagnostic === 'unconfigured' ? [...checks.filter(([name]) => !['relay_dns', 'relay_reach'].includes(name)), ['relay', 'Relay', '', 'skip', 'Relay checks were skipped because no relay is configured.', 'Open Settings and enter the relay URL provided by your organization.']] : checks;
  return entries.map(([name, , healthy, failure, problem, hint]) => {
    const result = state.diagnostic === 'failure' || failure === 'skip' ? failure : 'ok';
    return { name, status: result, detail: result === 'ok' ? healthy : problem, hint: result === 'ok' ? '' : hint };
  });
}

async function requestSdk(method, params = {}, requestId) {
  if (hasDesktopRpc) return window.setuDesktopRpc(method, params, requestId);
  if (method === 'devices.presence') return {devices:fixturePresence()};
  if (method === 'auth.set_token') return {subject:'fixture'};
  if (method === 'session.pair_adb') {
    const code = state.scenario==='wireless-unsupported' ? -32024 : state.scenario==='wireless-failed' ? -32023 : null;
    if (code) throw Object.assign(Error('Pairing fixture error'),{code});
    return {device_id:params.device_id,paired:true,transport:'relay-wss'};
  }
  if (method === 'session.connect') {
    if (state.scenario === 'cancel') return new Promise((_,reject) => { state.pending.abort = () => reject(Object.assign(Error('Cancelled'),{code:-32022})); });
    if (params.pairing_code && (params.pairing_code!==pairExample||state.pairUsed)) throw Object.assign(Error('Pairing rejected'),{code:-32013});
    const failure = devices.find(item=>item.id===params.device_id)?.failure;
    if (failure) throw Object.assign(Error('Access denied'),{code:failure});
    return {session_id:'ses_demo_0042',adb_addr:endpoint,device_id:params.device_id||'pixel-8a-casey'};
  }
  if (method === 'session.cancel') {
    const cancelled = Number(state.pending?.id===params.request_id && Boolean(state.pending?.abort));
    if (cancelled) state.pending.abort();
    return {cancelled};
  }
  if (method === 'session.stop' || method === 'devices.forget') return {};
  if (method === 'audit.verify') return fixtureChain();
  if (method === 'doctor') return { checks: doctorFixture() };
  const report = {
    generated_at: new Date().toISOString(), source: 'Offline design fixture', chain: fixtureChain(),
    totals: { records: 3, sessions: 2, operations: 1, denials: 0, revocations: 0, bytes_up: 0, bytes_down: 0, users: 0, devices: 1 },
    by_user: [], by_device: [], by_op: [], sessions: auditEvents.filter(entry => entry.event === 'session_start').map((entry, index) => ({
      session: `demo-${index + 1}`, device: entry.device, start: entry.ts, transport: entry.transport, operations: index, bytes_up: 0, bytes_down: 0
    })),
    denials: [], events: auditEvents
  };
  const { format } = params;
  if (format === 'json') return { format, report };
  if (format === 'csv') return { format, content: ['source,anchor,time,event,device,transport', ...auditEvents.map(entry => `Offline design fixture,${report.chain.anchor},${entry.ts},${entry.event},${entry.device},${entry.transport}`)].join('\r\n') };
  return { format, content: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Setu audit report · Offline design fixture</title><h1>Setu audit report</h1><p>Offline design fixture. Anchor status: ${report.chain.anchor}.</p><table><thead><tr><th>Time</th><th>Event</th><th>Device</th><th>Transport</th></tr></thead><tbody>${auditEvents.map(entry => `<tr><td>${entry.ts}</td><td>${entry.event}</td><td>${entry.device}</td><td>${entry.transport}</td></tr>`).join('')}</tbody></table></html>` };
}

async function loadSdkView(view) {
  const sequence = (loadSdkView.sequence || 0) + 1;
  loadSdkView.sequence = sequence;
  state.rpcError = '';
  state.rpcPending = view;
  if (view === 'audit') {
    state.liveChain = null;
    state.liveEvents = [];
    state.liveEventsError = false;
  } else {
    state.liveChecks = null;
  }
  render(true);
  try {
    if (view === 'audit') {
      const [chain, report] = await Promise.allSettled([requestSdk('audit.verify'), requestSdk('audit.report', { format: 'json', include_events: true })]);
      if (sequence !== loadSdkView.sequence) return;
      state.liveEvents = report.value?.report?.events || [];
      state.liveEventsError = report.status === 'rejected';
      if (chain.status === 'rejected' || !chain.value) throw new Error('Verification unavailable');
      state.liveChain = chain.value;
    } else {
      const response = await requestSdk('doctor');
      if (sequence !== loadSdkView.sequence) return;
      state.liveChecks = response.checks || [];
    }
  } catch {
    if (sequence === loadSdkView.sequence) state.rpcError = 'The local daemon did not return a response. Confirm Setu is running and open this screen again.';
  } finally {
    if (sequence === loadSdkView.sequence) {
      state.rpcPending = '';
      if (state.view === view) render(true);
    }
  }
}

function auditIntegrity() {
  const chain = hasDesktopRpc ? state.liveChain : fixtureChain();
  if (!chain) return 'unverified';
  if (chain.valid === false || chain.anchor === 'invalid') return 'tampered';
  return chain.valid && chain.anchor === 'verified' ? 'verified' : 'unverified';
}

function setRejoinStage(stage) {
  clearPath();
  const event = {session:state.session.rpcId,fields:{session_id:'fixture-stream',transport:'relay-wss'}};
  if (stage==='silent'||stage==='holding') {
    state.session.adb='device';
    receiveEvent({...event,type:'path_down'});
    if (stage==='holding') {
      const item=outages.get('fixture-stream');
      clearTimeout(item.timer);
      item.stage='holding';
    }
  } else if (stage==='lost') {
    state.session.adb='offline';
    receiveEvent({...event,type:'path_lost'});
  } else {
    state.session.adb='none';
    receiveEvent({...event,type:'path_up'});
    state.rejoin='restored';
  }
  if (stage !== 'restored') updatePathView();
  render();
  shell.querySelector('#rejoin-stage')?.focus();
}

window.setuDesktopEvent=receiveEvent;
window.setuDesktopSessionDeadline=setSessionDeadline;
window.setuDesktopStartupArguments=()=>state.settings.label?['--label',state.settings.label]:[];
try { state.settings.label=(localStorage.getItem('setu.computer-name')||'').slice(0,64); } catch { /* File preview storage can be disabled. */ }
window.setuDesktopAdbStatus=({adb_addr,status})=>{
  if (state.session?.addr!==adb_addr||!Object.hasOwn(labels,status)) return;
  state.session.adb=status;
  if (status==='device') for (const [id,item] of outages) if (item.stage==='lost') outages.delete(id);
  updatePathView();
};

document.addEventListener('click', async event => {
  const control = event.target.closest('button[data-action], a[data-action]');
  if (!control) return;
  event.preventDefault();
  const { action, value } = control.dataset;
  switch (action) {
    case 'nav': go(value); break;
    case 'close': closeDialog(); break;
    case 'scenarios':
      openDialog('Demo scenarios', `<p class="muted dialog-intro">Choose an offline SDK fixture to review its main flow and recovery states.</p><div class="scenario-grid">${scenarios.map(item => scenarioButton(item)).join('')}</div>`, true);
      break;
    case 'scenario': runScenario(value); break;
    case 'mode':
      openDialog('Switch workspace', `<div class="workspace-options">
        ${scenarioButton(['solo', 'Solo', 'Local pairing without an account.', 'laptop'], 'set-mode')}
        ${scenarioButton(['corporate', 'Corporate', 'Browser SSO and policy-managed device access.', 'shield'], 'set-mode')}</div>`);
      break;
    case 'set-mode':
      if (state.session && state.mode !== value) {
        openDialog('Switch workspace?', `<p>Disconnect the current session before changing the daemon’s workspace mode.</p><div class="button-row dialog-actions">${button('close', 'Keep session', 'secondary')}${button('confirm-mode', 'Disconnect and switch', 'primary', 'arrow', value)}</div>`);
      } else chooseMode(value);
      break;
    case 'confirm-mode':
      if (state.session) { try { await requestSdk('session.stop',{session_id:state.session.rpcId}); } catch { announce('Could not disconnect before switching.'); break; } }
      chooseMode(value); break;
    case 'sso': ssoDialog(); break;
    case 'sso-return':
      try { await requestSdk('auth.set_token', {token:'fixture-token'}); credentialUpdated(); } catch { announce('The daemon rejected the credential.'); }
      break;
    case 'refresh-presence': void refreshDirectory(); break;
    case 'cancel-connect': void cancelPending(); break;
    case 'recover-session': {
      const device_id = [-32025,-32026].includes(state.error) && state.recoverDevice;
      state.error = null;
      if (device_id && state.sso) void connectDevice({device_id});
      else go('devices');
      break;
    }

    case 'admin':
      openDialog('Contact your IT administrator', `<p>Share the error code and device ID with your IT help desk. Ask them to review your grant, corporate identity, or Android device policy.</p>`);
      break;
    case 'pair': pairDialog(); break;
    case 'device': deviceDialog(value); break;
    case 'resume': {
      const device = pairedDevices().find(entry => entry.id === value);
      if (!device || state.error || (state.mode === 'corporate' && !state.sso)) break;
      if (state.session) {
        openDialog('A local listener is running', `<p>Disconnect the current session before creating a new one.</p>${button('nav', 'View current session', 'secondary', 'arrow', 'workspace')}`);
      } else void connectDevice({device_id:device.id});
      break;
    }
    case 'forget':
      openDialog('Forget this paired device?', `<p>Setu will remove the paired record on this computer using <code>devices.forget</code>. Reconnect with a current pairing code from the phone.</p>
        <div class="button-row dialog-actions">${button('close', 'Cancel', 'secondary')}${button('forget-confirm', 'Forget paired device', 'primary danger-fill', '', value)}</div>`);
      break;
    case 'forget-confirm':
      try { await requestSdk('devices.forget',{device_id:value}); } catch { announce('Could not forget the device.'); break; }
      state.paired.delete(value);
      go('devices');
      announce('Local paired record removed.');
      break;
    case 'disconnect':
      openDialog('Disconnect this session?', `<p>Stop this computer’s local listener and the ADB streams using it.</p><div class="button-row dialog-actions">${button('close', 'Keep session', 'secondary')}${button('end-session', 'Disconnect', 'primary danger-fill', 'unlink')}</div>`);
      break;
    case 'end-session':
      if (!state.session) break;
      try { await requestSdk('session.stop',{session_id:state.session.rpcId}); } catch { announce('Could not stop the session.'); break; }
      state.session = null;
      clearPath();
      state.rejoin = '';
      state.cap = false;
      state.stagePreview = false;
      go('workspace');
      announce('Local listener stopped.');
      break;
    case 'background': state.inTray = true; render(true); break;
    case 'restore': go('workspace'); break;
    case 'clear-error': state.error = null; go('devices'); break;
    case 'connect-adb':
      if (state.session && hasDesktopRpc) {
        if (typeof window.setuDesktopConnectAdb==='function') {
          try { await window.setuDesktopConnectAdb(state.session.addr); } catch { announce('Could not run local ADB.'); }
        } else void copyText(attachCommand());
      } else if (state.session) {
        state.session.adb='device';
        state.session.path ||= 'relay-wss';
        state.session.wire ||= 'tls';
        for (const [id,item] of outages) if (item.stage==='lost') outages.delete(id);
        updatePathView();
        announce('Fixture ADB host reports device.');
      }
      break;

    case 'copy-adb': copyText(attachCommand()); break;
    case 'wireless': wirelessDialog(); break;
    case 'report': reportDialog(); break;
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const field = name => String(fields.get(name) || '').trim();
  switch (form.dataset.form) {
    case 'pair': {
      const code = formatPairing(field('code'));
      if (!/^\d{4}-\d{6}$/.test(code)) return showError('pair-error', 'Enter all ten digits from the Android phone.', form.elements.code);
      form.elements.code.value='';
      void connectDevice({pairing_code:code});
      break;
    }
    case 'wireless': {
      if (state.pending||!state.session) break;
      const code=field('code'), port=field('port');
      if (!/^[0-9]{6}$/.test(code)) return showError('wireless-error','Enter the six-digit code shown by Android.',form.elements.code);
      if (port&&(!/^[0-9]{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)) return showError('wireless-error','Enter a port from 1 to 65535, or leave it empty.',form.elements.port);
      const params={device_id:state.session.id,pairing_code:code};
      if (port) params.pairing_port=Number(port);
      form.elements.code.value='';
      try {
        const result=await pendingRequest('session.pair_adb',params);
        if (!result?.paired) throw Error('Pair failed');
        closeDialog();
        announce('Android debugger paired. Use Connect ADB to attach.');
      } catch (error) {
        if (error?.code===-32022) { closeDialog(); announce('Android pairing cancelled.'); break; }
        wirelessDialog();
        const message=error?.code===-32024?'Update Setu on the phone to use this':'Android pairing failed. Reopen the Android pairing screen and check the current code and optional port.';
        const input=dialog.querySelector('#system-code');
        if (input) showError('wireless-error',message,input);
        else announce(message);
      }
      break;
    }

    case 'nickname':
      if (!field('nickname')) {
        form.elements.nickname.value = '';
        form.reportValidity();
        break;
      }
      state.nicknames[form.dataset.device] = field('nickname');
      go('devices');
      announce('Local nickname saved for this preview.');
      break;
    case 'settings': {
      if (!validRelay(field('relay'))) return showError('setting-error', 'Enter a valid wss:// or ws:// relay URL, or a TCP host:port.', form.elements.relay);
      if (field('pin') && !/^(?:[a-f\d]{64}|(?:[a-f\d]{2}:){31}[a-f\d]{2})$/i.test(field('pin'))) return showError('setting-error', 'Enter a 64-digit hexadecimal SHA-256 pin with optional colon separators.', form.elements.pin);
      if (!parseUrl(field('proxy'), ['http:'])) return showError('setting-error', 'Enter an HTTP CONNECT proxy URL without credentials.', form.elements.proxy);
      state.settings = { relay: field('relay'), pin: field('pin'), proxy: field('proxy'), label: field('label') };
      try { localStorage.setItem('setu.computer-name',state.settings.label); } catch { /* File preview storage can be disabled. */ }
      announce('Preview settings saved.');
      break;
    }
    case 'report': {
      const format = field('format');
      const types = { json: 'application/json', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8' };
      if (!Object.hasOwn(types, format)) return;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const response = await requestSdk('audit.report', { format });
        const content = format === 'json' ? JSON.stringify(response.report, null, 2) : response.content;
        if (typeof content !== 'string') throw new Error('Malformed report response');
        download(content, types[format], format);
        if (form.isConnected) closeDialog();
        announce(`${hasDesktopRpc ? 'Local' : 'Fixture'} ${format.toUpperCase()} report downloaded.`);
      } catch {
        submit.disabled = false;
        announce('The audit report could not be generated.');
      }
      break;
    }
  }
});

document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'pair-code') {
    if (/[^0-9\s-]/.test(input.value) || input.value.replace(/\D/g, '').length > 10) {
      input.value = input.dataset.formatted || '';
      return showError('pair-error', 'Use ten digits, with a hyphen after the fourth digit.', input);
    }
    const digitsBeforeCaret = input.value.slice(0, input.selectionStart).replace(/\D/g, '').length;
    input.value = formatPairing(input.value);
    input.dataset.formatted = input.value;
    const caret = digitsBeforeCaret + (digitsBeforeCaret > 4 ? 1 : 0);
    input.setSelectionRange(caret, caret);
  }
  if (input.id === 'system-code' || input.id === 'system-port') input.value = input.value.replace(/\D/g, '');
  input.removeAttribute('aria-invalid');
  const error = input.form?.querySelector('.error-message');
  if (error) error.hidden = true;
});

document.addEventListener('change', event => {
  const control = event.target;
  switch (control.dataset.action) {
    case 'audit-result': state.audit = control.value; render(); shell.querySelector('#audit-result').focus(); break;
    case 'doctor-result': state.diagnostic = control.value; render(); shell.querySelector('#doctor-result').focus(); break;
    case 'rejoin-stage': setRejoinStage(control.value); break;
  }
});

const initialScenario = new URLSearchParams(location.search).get('scenario');
if (hasDesktopRpc) {
  document.querySelector('[data-action="scenarios"]').hidden=true;
  if (initialScenario==='corporate') state.mode='corporate';
  go(['audit','doctor'].includes(initialScenario)?initialScenario:'workspace');
  window.addEventListener('focus', () => { if (state.mode === 'corporate' && state.sso) void refreshDirectory(); });
  setInterval(() => { if (state.mode === 'corporate' && state.sso) void refreshDirectory(); }, 30000);
  void requestSdk('events.subscribe').catch(()=>announce('Could not subscribe to session updates.'));
} else {
  runScenario(scenarios.some(([name])=>name===initialScenario)?initialScenario:'live');
}
