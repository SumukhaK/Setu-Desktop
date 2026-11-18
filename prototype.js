'use strict';

const shell = document.querySelector('#shell');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const evidenceFile = document.querySelector('#evidence-file');
const endpoint = '127.0.0.1:27183';
const command = `adb connect ${endpoint}`;
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
  { id: 'pixel', name: 'Pixel 8', detail: 'Android 15 · This morning', platform: 'Android 15', owner: 'Morgan Lee', workspace: 'solo', access: 'allowed', appearance: 'blue' },
  { id: 'samsung', name: 'Galaxy S24', detail: 'Android 14 · Yesterday', platform: 'Android 14', owner: 'Morgan Lee', workspace: 'solo', access: 'offline', appearance: 'lavender' },
  { id: 'pixel-new', name: 'Pixel 8a', detail: 'Android 15 · Just paired', platform: 'Android 15', owner: 'Casey Patel', workspace: 'solo', access: 'allowed', appearance: 'mint' },
  { id: 'lab', name: 'Pixel 8 · QA Lab', detail: 'Android 15 · Shared lab', platform: 'Android 15', owner: 'Northstar QA', workspace: 'corporate', access: 'allowed', appearance: 'blue' },
  { id: 'kiosk', name: 'Galaxy XCover 6 Pro', detail: 'Android 14 · Retail fleet', platform: 'Android 14', owner: 'Northstar QA', workspace: 'corporate', access: 'denied', appearance: 'lavender' }
];

const samples = [
  { id: 'screenshot', title: 'Checkout confirmation', kind: 'Screenshot', note: 'Order confirmation loaded with the correct status.', time: 'Today, 10:48 AM', device: 'Pixel 8', workspace: 'solo', visual: 'checkout' },
  { id: 'recording', title: 'Sign-in retry', kind: 'Recording', note: 'Second attempt succeeded after the connection recovered.', time: 'Yesterday, 4:21 PM', device: 'Galaxy S24', workspace: 'solo', visual: 'signin' },
  { id: 'corporate-screenshot', title: 'QA checkout result', kind: 'Screenshot', note: 'Confirmation rendered correctly in the QA build.', time: 'Today, 10:53 AM', device: 'Pixel 8 · QA Lab', workspace: 'corporate', visual: 'checkout' }
];

const defaultTimeline = [
  { time: '10:42:09', title: 'ADB attached', detail: 'Local debugger authorized' },
  { time: '10:42:07', title: 'Encrypted tunnel ready', detail: 'Setu relay · Frankfurt' },
  { time: '10:42:04', title: 'Phone owner approved', detail: 'Morgan Lee · Pixel 8' }
];

const state = {
  design: 'relay', view: 'workspace', mode: 'solo', person: { name: 'Morgan Lee', email: 'morgan@example.com', member: true, managed: false },
  phase: 'attached', sessionDevice: 'pixel', sessionMode: 'solo', remembered: new Set(['pixel', 'samsung']),
  evidence: samples.map(item => ({ ...item })), events: [...defaultTimeline], history: [],
  tray: false, background: true, auth: 'welcome', email: '', authFlow: 'signin', emailSent: 0,
  capture: false, selected: '', focusBack: null
};

const navItems = [
  ['workspace', 'grid', 'Workspace'],
  ['devices', 'phone', 'Devices'],
  ['evidence', 'image', 'Evidence'],
  ['history', 'history', 'History'],
  ['audit', 'shield', 'Audit log']
];

const phaseLabels = {
  idle: ['No active session', 'neutral'],
  pending: ['Awaiting approval', 'warning'],
  ready: ['Tunnel ready', 'good'],
  attached: ['ADB attached', 'good'],
  reconnecting: ['Reconnecting', 'warning'],
  offline: ['Device offline', 'warning'],
  ended: ['Session ended', 'neutral']
};

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name, size = 18) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const button = (action, label, css = '', symbol = '', value = '') => `<button type="button" class="button ${css}" data-action="${action}"${value ? ` data-value="${safe(value)}"` : ''}>${symbol ? icon(symbol) : ''}${safe(label)}</button>`;
const status = (label, theme = 'neutral') => `<span class="status ${theme}"><span aria-hidden="true"></span>${safe(label)}</span>`;
const activeDevice = () => devices.find(device => device.id === state.sessionDevice) || devices[0];
const visiblePhase = () => state.mode === state.sessionMode ? state.phase : 'idle';
const hasSession = () => ['pending', 'ready', 'attached', 'reconnecting', 'offline'].includes(visiblePhase());
const workspaceName = () => state.mode === 'corporate' ? 'Northstar QA' : 'Personal workspace';
const initials = () => state.person.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
const currentEvidence = () => state.evidence.filter(item => item.workspace === state.mode);
const timeNow = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const dateNow = () => new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function railButton([value, symbol, title]) {
  const isCurrent = state.view === value;
  return `<button type="button" data-action="nav" data-value="${value}" class="nav-link${isCurrent ? ' active' : ''}"${isCurrent ? ' aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></button>`;
}

function render(focus = false) {
  document.body.dataset.design = state.design;
  for (const swatch of document.querySelectorAll('[data-action="design"]')) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.value === state.design));
  }

  if (!state.person) {
    shell.innerHTML = `<main id="main" class="center-stage" tabindex="-1">${authPage()}</main>`;
  } else if (state.tray) {
    shell.innerHTML = `<main id="main" class="center-stage" tabindex="-1"><div class="tray-page card">
      <div class="feature-icon">${icon('tray', 26)}</div><h1 tabindex="-1">Running in the background</h1>
      <p>${safe(activeDevice().name)} · ${status(...phaseLabels[visiblePhase()])}</p>
      <p class="muted">The Setu tray keeps this session available while the workspace is closed.</p>
      <div class="button-row">${button('restore', 'Restore workspace', 'primary', 'monitor')}${button('disconnect', 'Disconnect', 'secondary', 'unlink')}</div></div></main>`;
  } else {
    const settings = railButton(['settings', 'settings', 'Settings']);
    const help = railButton(['help', 'help', 'Troubleshooting']);
    shell.innerHTML = `<aside class="rail">
      <button type="button" class="workspace-picker" data-action="mode" aria-label="Switch workspace">
        <span class="workspace-glyph">${icon(state.mode === 'corporate' ? 'shield' : 'laptop', 20)}</span>
        <span><strong>${workspaceName()}</strong><small>${state.mode === 'solo' ? 'Solo mode' : 'Corporate mode'}</small></span>${icon('down', 15)}
      </button>
      <nav class="rail-nav" aria-label="Workspace navigation">${navItems.filter(([name]) => name !== 'audit' || state.mode === 'corporate').map(railButton).join('')}</nav>
      <nav class="rail-tools" aria-label="Support and preferences">${help}${settings}</nav>
      <button type="button" class="profile" data-action="nav" data-value="settings" aria-label="Profile and settings"><span class="avatar">${safe(initials())}</span><span><strong>${safe(state.person.name)}</strong><small>${safe(state.person.email)}</small></span>${icon('down', 14)}</button>
    </aside><main id="main" class="main-pane" tabindex="-1"><div class="main-inner">${renderView()}</div><footer class="app-status"><span>${status('Relay online', 'good')}</span><span>Simulated workspace <span class="footer-divider">·</span> ${safe(state.design[0].toUpperCase() + state.design.slice(1))} preview</span></footer></main>`;
  }

  if (focus) (shell.querySelector('h1') || shell.querySelector('main')).focus();
}

function renderView() {
  switch (state.view) {
    case 'devices': return devicesPage();
    case 'evidence': return evidencePage();
    case 'history': return historyPage();
    case 'audit': return auditPage();
    case 'help': return helpPage();
    case 'settings': return settingsPage();
    default: return workspacePage();
  }
}

function heading(title, subtitle, actions = '') {
  return `<header class="page-heading"><div><h1 tabindex="-1">${safe(title)}</h1><p>${safe(subtitle)}</p></div>${actions ? `<div class="button-row">${actions}</div>` : ''}</header>`;
}

function workspacePage() {
  const phase = visiblePhase();
  const pageTitle = heading('Workspace', `${workspaceName()} / ${state.mode === 'solo' ? 'Solo' : 'Corporate'}`, button('pair', state.mode === 'solo' ? 'Connect device' : 'Select device', 'primary', 'plus'));
  if (state.mode === 'corporate' && !state.person.member) return pageTitle + deniedWorkspace();
  if (state.design === 'signal') {
    return pageTitle + `<div class="signal-strip" aria-label="Session status">
      <div><small>TRANSPORT</small>${status(['ready', 'attached'].includes(phase) ? 'Encrypted relay' : phaseLabels[phase][0], phaseLabels[phase][1])}</div>
      <div><small>LOCAL DEBUGGER</small><strong>${phase === 'attached' ? 'ADB attached' : 'Awaiting ADB'}</strong></div>
      <div><small>ROUND TRIP</small><strong>${['ready', 'attached'].includes(phase) ? '42 ms' : '—'}</strong></div>
      <div><small>RELAY REGION</small><strong>EU · Frankfurt</strong></div>
    </div><div class="home-grid signal-grid">${sessionCard()}${activityPanel()}${devicePanel()}${evidencePanel()}</div>`;
  }
  if (state.design === 'field') {
    return pageTitle + `<div class="field-grid"><section class="field-story"><div class="field-head"><div><p class="eyebrow">TESTER HANDOFF</p><h2>Session evidence</h2></div>${button('nav', 'Evidence library', 'quiet', 'arrow', 'evidence')}</div>
      ${currentEvidence().length ? `<div class="field-evidence">${currentEvidence().slice(0, 2).map(item => evidenceTile(item)).join('')}</div>` : '<div class="card empty"><p>Capture or import evidence to start a handoff.</p></div>'}
      <div class="field-import">${button('capture', 'Capture evidence', 'secondary', 'image')}${button('import', 'Import file', 'quiet', 'inbox')}</div>${activityPanel()}</section>
      <div class="field-side">${sessionCard()}${devicePanel()}</div></div>`;
  }
  return pageTitle + `<div class="home-grid relay-grid">${sessionCard()}${detailsPanel()}${devicePanel()}${evidencePanel()}</div>`;
}

function sessionCard() {
  const phase = visiblePhase();
  const device = activeDevice();
  if (!hasSession()) return `<section class="card session-card">
    <div class="section-header"><h2 class="eyebrow">Debug session</h2>${status(...phaseLabels[phase])}</div>
    <div class="empty-session"><div class="feature-icon">${icon('link', 28)}</div><h3>${phase === 'ended' ? 'Session ended' : 'Connect an Android device'}</h3>
    <p class="muted">${phase === 'ended' ? safe(state.history[0]?.reason || 'You disconnected the session.') : 'Enter a code from Setu on Android or choose an available device.'}</p>
    ${button('pair', state.mode === 'solo' ? 'Connect device' : 'Select device', 'primary', 'plus')}</div></section>`;

  const isLinked = ['ready', 'attached'].includes(phase);
  const phaseContent = {
    pending: '<strong>Waiting for the phone owner.</strong> They can approve or decline this request on Android.',
    ready: '<strong>Tunnel authenticated.</strong> Connect your local debugger to attach ADB.',
    attached: '<strong>ADB is attached.</strong> The local endpoint is available to your debugger.',
    reconnecting: '<strong>Restoring the tunnel.</strong> Your debugger can reconnect when the phone is reachable.',
    offline: '<strong>Phone is unreachable.</strong> Ask the owner to reopen Setu and check Wi-Fi.'
  };
  return `<section class="card session-card"><div class="section-header"><h2 class="eyebrow">Current session</h2>${status(...phaseLabels[phase])}</div>
    <div class="session-title"><div class="device-glyph ${device.appearance}">${icon('phone', 24)}</div><div><h3>${safe(device.name)}</h3><p>${safe(device.platform)} <span>·</span> ${state.mode === 'solo' ? 'Personal device' : 'Managed device'}</p></div><span class="session-id">SET–0842</span></div>
    <div class="topology${isLinked ? '' : ' interrupted'}" aria-label="Route from this desktop through the Setu relay to the Android device">
      <div class="topology-unit"><div class="topology-node">${icon('monitor', 24)}</div><strong>This desktop</strong><small>Local ADB</small></div>
      <div class="topology-line"><span></span></div>
      <div class="topology-unit"><div class="topology-node relay-node">${icon('lock', 22)}</div><strong>Setu relay</strong><small>${isLinked ? 'Encrypted' : 'Path pending'}</small></div>
      <div class="topology-line"><span></span></div>
      <div class="topology-unit"><div class="topology-node">${icon('phone', 24)}</div><strong>${safe(device.name)}</strong><small>Android host</small></div>
    </div>
    <p class="session-note">${icon(phase === 'attached' ? 'check' : 'info', 17)} <span>${phaseContent[phase]}</span></p>
    ${isLinked ? `<div class="command"><span aria-hidden="true">${icon('terminal', 16)}</span><code>${command}</code>${button('copy-adb', 'Copy', 'quiet copy-command', 'copy')}</div>` : ''}
    <div class="session-actions">
      ${phase === 'pending' ? `${button('approve', 'Simulate approval', 'primary', 'check')}${button('decline', 'Simulate decline', 'secondary')}` : ''}
      ${phase === 'ready' ? button('attach', 'Simulate ADB attach', 'primary', 'terminal') : ''}
      ${['reconnecting', 'offline'].includes(phase) ? button('retry', 'Retry connection', 'primary', 'refresh') : ''}
      ${isLinked && state.background ? button('background', 'Move to tray', 'quiet', 'tray') : ''}
      ${button('disconnect', 'Disconnect', 'quiet danger', 'unlink')}
    </div>
  </section>`;
}

function detailsPanel() {
  const phase = visiblePhase();
  const linked = ['ready', 'attached'].includes(phase);
  return `<section class="card details-card"><div class="section-header"><h2>Connection details</h2>${icon('shield', 19)}</div>
    <dl class="detail-list">
      <div><dt>Transport</dt><dd>${status(linked ? 'Encrypted' : 'Waiting', linked ? 'good' : 'neutral')}</dd></div>
      <div><dt>ADB status</dt><dd>${phase === 'attached' ? 'Attached' : 'Not attached'}</dd></div>
      <div><dt>Round trip</dt><dd>${linked ? '42 ms' : '—'}</dd></div>
      <div><dt>Relay region</dt><dd>Frankfurt · EU</dd></div>
      <div><dt>Session owner</dt><dd>${hasSession() ? safe(activeDevice().owner) : '—'}</dd></div>
    </dl><div class="details-link">${button('nav', 'View troubleshooting', 'quiet', 'help', 'help')}</div>
  </section>`;
}

function activityPanel() {
  const entries = state.mode === state.sessionMode ? state.events.slice(0, 4) : [];
  return `<section class="card activity-card"><div class="section-header"><h2>Session activity</h2>${button('nav', 'History', 'quiet small', 'history', 'history')}</div>
    ${entries.length ? `<ol class="timeline">${entries.map(item => `<li><time>${safe(item.time)}</time><div><strong>${safe(item.title)}</strong><small>${safe(item.detail)}</small></div></li>`).join('')}</ol>` : '<p class="muted inset">Session events will appear here after a connection starts.</p>'}
  </section>`;
}
function deviceRows(limit = Infinity) {
  const entries = devices.filter(device => device.workspace === state.mode && (state.mode === 'corporate' || state.remembered.has(device.id))).slice(0, limit);
  return entries.length ? `<ul class="list">${entries.map(device => {
    const connected = hasSession() && activeDevice().id === device.id && ['ready', 'attached'].includes(visiblePhase());
    const label = connected ? 'In session' : { allowed: 'Available', offline: 'Offline', denied: 'Restricted' }[device.access];
    return `<li><button type="button" class="list-row" data-action="device" data-value="${device.id}">
      <span class="row-glyph ${device.appearance}">${icon('phone', 19)}</span><span class="row-copy"><strong>${safe(device.name)}</strong><small>${safe(device.detail)}</small></span>
      ${status(label, connected ? 'good' : device.access === 'denied' ? 'warning' : 'neutral')}${icon('chevron', 15)}</button></li>`;
  }).join('')}</ul>` : '<p class="muted inset">Devices you remember will appear here.</p>';
}

function devicePanel() {
  return `<section class="card device-card"><div class="section-header"><h2>${state.mode === 'solo' ? 'Remembered devices' : 'Organization devices'}</h2>${button('nav', 'View all', 'quiet small', '', 'devices')}</div>${deviceRows(2)}</section>`;
}

function devicesPage() {
  const intro = heading('Devices', state.mode === 'solo' ? 'Remembered phones in your personal workspace' : 'Enrolled phones and your device grants', button('pair', state.mode === 'solo' ? 'Connect device' : 'Select device', 'primary', 'plus'));
  if (state.mode === 'corporate' && !state.person.member) return intro + deniedWorkspace();
  return intro + `<div class="page-grid"><section class="card standard-card"><div class="section-header"><h2>${state.mode === 'solo' ? 'Remembered devices' : 'Organization devices'}</h2></div>${deviceRows()}</section>
    <section class="card standard-card"><div class="feature-icon">${icon(state.mode === 'solo' ? 'phone' : 'shield', 25)}</div><h2>${state.mode === 'solo' ? 'Connecting a new phone' : 'Managing access'}</h2><p class="muted">${state.mode === 'solo' ? 'Ask the owner to open Setu, start hosting, and share their pairing code.' : 'Northstar QA administrators manage enrollment and per-device grants.'}</p>${state.mode === 'solo' ? button('nav', 'Phone setup guide', 'secondary', 'help', 'help') : button('admin', 'Administrator contact', 'secondary', 'mail')}</section></div>`;
}

function mediaThumbnail(item, large = false) {
  if (item.file && item.kind === 'Screenshot') return `<div class="media-preview imported"><img src="${safe(item.url)}" alt="${safe(item.title)}"></div>`;
  if (item.file && item.kind === 'Recording' && large) return `<div class="media-preview imported"><video src="${safe(item.url)}" controls preload="metadata" aria-label="${safe(item.title)}"></video></div>`;
  if (item.file) return `<div class="media-preview imported"><div class="feature-icon">${icon('video', 28)}</div></div>`;
  return `<div class="media-preview ${item.visual === 'signin' ? 'sample-signin' : 'sample-checkout'}${large ? ' large' : ''}" ${large ? `role="img" aria-label="${item.visual === 'signin' ? 'Demo Android sign-in screen' : 'Demo Android order confirmation screen'}"` : 'aria-hidden="true"'}>
    <div class="mock-phone"><span class="mock-speaker"></span><span class="mock-mark">${item.visual === 'signin' ? icon('user', 20) : icon('check', 20)}</span><strong>${item.visual === 'signin' ? 'Welcome back' : 'Order confirmed'}</strong><i></i><i></i><b></b></div>
    ${item.kind === 'Recording' ? `<span class="media-indicator">${icon('video', 14)} Demo clip</span>` : ''}
    </div>`;
}

function evidenceTile(item) {
  return `<button type="button" data-action="review" data-value="${safe(item.id)}" class="card evidence-tile">${mediaThumbnail(item)}
    <span class="tile-description"><small>${safe(item.kind)} · ${safe(item.time)}</small><strong>${safe(item.title)}</strong><span>${safe(item.device)}</span></span>${icon('chevron', 16)}</button>`;
}

function evidencePanel() {
  const items = currentEvidence().slice(0, 2);
  return `<section class="card evidence-card"><div class="section-header"><h2>Recent evidence</h2>${button('nav', 'View all', 'quiet small', '', 'evidence')}</div>
    ${items.length ? `<ul class="list">${items.map(item => `<li><button type="button" class="list-row" data-action="review" data-value="${safe(item.id)}"><span class="row-glyph ${item.kind === 'Recording' ? 'lavender' : 'mint'}">${icon(item.kind === 'Recording' ? 'video' : 'image', 18)}</span><span class="row-copy"><strong>${safe(item.title)}</strong><small>${safe(item.kind)} · ${safe(item.time)}</small></span>${icon('chevron', 15)}</button></li>`).join('')}</ul>` : '<p class="muted inset">Screenshots and recordings will appear here.</p>'}</section>`;
}

function evidencePage() {
  const actions = button('import', 'Import file', 'secondary', 'inbox') + button('capture', 'Capture evidence', 'primary', 'image');
  const intro = heading('Evidence', `${workspaceName()} screenshots and recordings`, state.mode === 'corporate' && !state.person.member ? '' : actions);
  if (state.mode === 'corporate' && !state.person.member) return intro + deniedWorkspace();
  const items = currentEvidence();
  return intro + (items.length ? `<div class="evidence-gallery">${items.map(item => evidenceTile(item)).join('')}</div>` : `<section class="card empty"><div class="feature-icon">${icon('image', 25)}</div><h2>No evidence yet</h2><p class="muted">Capture or import a screenshot or recording to start a handoff.</p></section>`);
}

function historyPage() {
  if (state.mode === 'corporate' && !state.person.member) return heading('History', `${workspaceName()} sessions`) + deniedWorkspace();
  const records = state.history.filter(record => record.mode === state.mode);
  return heading('History', `${workspaceName()} sessions`) + `<div class="page-grid">
    <section class="card"><div class="section-header"><h2>Ended sessions</h2></div>${records.length ? `<ul class="list">${records.map(record => `<li class="static-row"><span class="row-glyph blue">${icon('phone', 18)}</span><div class="row-copy"><strong>${safe(record.device)}</strong><small>${safe(record.reason)}</small></div><span class="muted">${safe(record.time)}</span></li>`).join('')}</ul>` : '<p class="muted inset">Ended sessions will appear here.</p>'}</section>${activityPanel()}</div>`;
}

function deniedWorkspace() {
  return `<section class="card empty denied-page"><div class="feature-icon">${icon('lock', 26)}</div><h2>Corporate access unavailable</h2><p class="muted">Northstar QA has no verified membership for this account. Ask an administrator to assign the account to the organization.</p>${button('admin', 'Administrator contact', 'secondary', 'mail')}</section>`;
}

function auditRows() {
  const live = state.sessionMode === 'corporate' ? state.events.map(event => [event.time, event.title, event.detail]) : [];
  return [...live,
    ['10:31:22', 'Session ended', 'Pixel 8 · QA Lab · user disconnected'],
    ['10:05:18', 'Tunnel authenticated', 'Pixel 8 · QA Lab · Frankfurt'],
    ['09:36:09', 'Device access denied', 'Galaxy XCover 6 Pro · grant missing']
  ];
}

function auditPage() {
  if (state.mode !== 'corporate' || !state.person.member) return heading('Audit log', 'Northstar QA session records') + deniedWorkspace();
  return heading('Audit log', 'Northstar QA session records', button('audit-export', 'Export CSV', 'primary', 'inbox')) + `<section class="card standard-card">
    <div class="section-header"><h2>Organization activity</h2>${status('Session-level events', 'good')}</div>
    <div class="table-wrap"><table><thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Details</th></tr></thead><tbody>
    ${auditRows().map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="muted inset">Reports include session metadata. Device TLS can limit operation-level visibility.</p></section>`;
}

function settingsPage() {
  return heading('Settings', 'Account, workspace and local tools') + `<div class="page-grid settings-grid">
    <section class="card standard-card"><h2>Profile</h2><dl class="detail-list"><div><dt>Name</dt><dd>${safe(state.person.name)}</dd></div><div><dt>Email</dt><dd>${safe(state.person.email)}</dd></div><div><dt>Workspace</dt><dd>${workspaceName()}</dd></div></dl>
    <div class="button-row">${button('mode', 'Switch workspace', 'secondary', 'down')}${button('signout', 'Sign out', 'quiet danger')}</div></section>
    <section class="card standard-card"><h2>Local tools</h2><div class="setting-row"><span><strong>Setu relay</strong><small>Frankfurt · EU</small></span>${status('Online', 'good')}</div><div class="setting-row"><span><strong>Android Debug Bridge</strong><small>Local ADB installation</small></span>${button('diagnostic', 'Run check', 'secondary small', 'terminal')}</div>
    <label class="setting-row"><span><strong>Keep sessions in the tray</strong><small>Allows background debugging</small></span><input type="checkbox" data-action="tray-setting" ${state.background ? 'checked' : ''}></label>
    <div class="setting-row"><span><strong>Solo mode</strong><small>${state.person.managed ? 'Disabled by Northstar QA policy' : 'Personal device pairing'}</small></span>${status(state.person.managed ? 'Locked' : 'Available', state.person.managed ? 'warning' : 'neutral')}</div></section></div>`;
}

function helpPage() {
  return heading('Troubleshooting', 'Android setup, local ADB and tunnel recovery') + `<div class="page-grid help-grid">
    <section class="card standard-card"><div class="feature-icon">${icon('phone', 24)}</div><h2>Prepare the phone</h2><ol class="steps"><li>Open Settings, then About phone. Tap <strong>Build number</strong> seven times to enable Developer options.</li><li>Connect the phone to Wi-Fi and turn on <strong>Wireless debugging</strong> under Developer options.</li><li>Open Setu on the phone, recheck readiness, and start hosting.</li></ol><p class="muted">On some phones, look for Build number under Software information. USB debugging is for USB workflows.</p>${button('copy-checklist', 'Copy phone checklist', 'secondary', 'copy')}</section>
    <section class="card standard-card"><div class="feature-icon">${icon('terminal', 24)}</div><h2>Connect your debugger</h2><ol class="steps"><li>Install Android SDK Platform-Tools and confirm <code>adb version</code> runs locally.</li><li>After the tunnel is ready, use the session’s <code>adb connect</code> command in your terminal.</li><li>In Android Studio, select the connected phone in the device picker and run or debug your app.</li></ol>${button('diagnostic', 'Check local ADB', 'secondary', 'terminal')}</section>
    <section class="card standard-card"><h2>Recover a connection</h2><details><summary>Code is expired</summary><p>Ask the phone owner to refresh the pairing code, then enter the new code in Setu.</p></details><details><summary>Phone is offline</summary><p>Ask the owner to confirm Wi-Fi and reopen Setu. Retry once the phone is hosting again.</p></details><details><summary>Corporate grant or policy blocks access</summary><p>Ask the organization administrator to confirm membership, enrollment, and your device grant.</p></details><details><summary>Tunnel is ready and ADB is waiting</summary><p>Check Android’s Wireless debugging prompt and verify the trust request on the phone, then retry the local command.</p></details></section>
  </div>`;
}

function authPage() {
  if (state.auth === 'welcome') return `<section class="auth-card card"><div class="feature-icon">${icon('link', 26)}</div><h1 tabindex="-1">Welcome to Setu</h1><p class="muted">Sign in to connect to a remote Android device.</p><div class="auth-actions">${button('auth-intent', 'Sign in', 'primary', 'arrow', 'signin')}${button('auth-intent', 'Create account', 'secondary', 'plus', 'signup')}</div></section>`;
  if (state.auth === 'email') return `<section class="auth-card card"><div class="feature-icon">${icon('mail', 26)}</div><h1 tabindex="-1">${state.authFlow === 'signup' ? 'Create your account' : 'Sign in by email'}</h1><p class="muted">Use a one-time code to verify your email address.</p>
    <form data-form="email"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" value="${safe(state.email)}" placeholder="morgan@example.com" maxlength="160" required><div class="button-row">${button('auth-back', 'Back', 'secondary')}<button class="button primary" type="submit">Continue ${icon('arrow', 17)}</button></div></form></section>`;
  return `<section class="auth-card card"><div class="feature-icon">${icon('mail', 26)}</div><h1 tabindex="-1">Verify your email</h1><p class="muted">Enter the code for <strong>${safe(state.email)}</strong>.</p>
    <form data-form="verify" novalidate><label for="verification">Email verification code</label><input id="verification" name="code" type="text" inputmode="numeric" maxlength="12" autocomplete="one-time-code" aria-describedby="verify-hint verify-error" placeholder="000000" required><p id="verify-hint" class="hint">Demo code <code>723190</code> · expired example <code>000000</code></p><p id="verify-error" class="error-message" role="alert" hidden></p>
    <div class="button-row">${button('edit-email', 'Edit address', 'secondary')}<button class="button primary" type="submit">Verify email ${icon('arrow', 17)}</button></div></form>
    <div class="resend">${button('resend-email', 'Resend code', 'quiet small')}<span class="hint" id="resend-message" aria-live="polite"></span></div></section>`;
}
const scenarioList = [
  ['live', 'Active debugging', 'Pixel 8 with an encrypted tunnel and ADB attached.', 'terminal'],
  ['auth', 'Email sign-in', 'Create an account or sign in with a demo code.', 'mail'],
  ['pair', 'Pair a new phone', 'Try a valid, expired, or malformed device code.', 'link'],
  ['corporate', 'Corporate workspace', 'Connect to an authorized QA device and review the audit log.', 'shield'],
  ['managed', 'Managed account', 'Solo is locked by Northstar QA policy.', 'lock'],
  ['denied', 'Corporate access denied', 'Review what happens when membership is missing.', 'user'],
  ['reconnect', 'Dropped connection', 'Follow reconnecting, offline, and manual retry.', 'refresh'],
  ['evidence', 'Share an issue', 'Review, annotate, and export screenshots or recordings.', 'image']
];

function openDialog(title, content, css = '') {
  if (!dialog.open) state.focusBack = document.activeElement;
  dialog.className = css;
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title" tabindex="-1">${safe(title)}</h2><button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('close', 20)}</button></header><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  (dialog.querySelector('[data-autofocus]') || dialog.querySelector('#dialog-title')).focus();
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

dialog.addEventListener('close', () => {
  if (state.focusBack?.isConnected && !dialog.open && !document.activeElement.closest('#main')) state.focusBack.focus();
});

function scenariosDialog() {
  openDialog('Demo scenarios', `<p class="muted dialog-intro">Load a scenario to explore the same journey in any design. Loading a scenario resets the current demo.</p><div class="scenario-grid">${scenarioList.map(([key, title, detail, symbol]) => `<button class="scenario-option" type="button" data-action="scenario" data-value="${key}"><span class="row-glyph blue">${icon(symbol, 19)}</span><span><strong>${title}</strong><small>${detail}</small></span>${icon('chevron', 15)}</button>`).join('')}</div>`, 'wide-dialog');
}

function modeDialog() {
  openDialog('Switch workspace', `<div class="workspace-options">
    <button class="scenario-option" type="button" data-action="set-mode" data-value="solo" ${state.person.managed ? 'aria-disabled="true" aria-describedby="managed-policy"' : ''}><span class="row-glyph blue">${icon(state.person.managed ? 'lock' : 'laptop', 20)}</span><span><strong>Solo ${state.person.managed ? '· Locked' : ''}</strong><small>Pair personal Android devices with a code.</small></span>${state.mode === 'solo' ? icon('check', 18) : ''}</button>
    ${state.person.managed ? `<p id="managed-policy" class="notice warning">${icon('lock', 17)} Northstar QA requires managed debugging. Solo mode is disabled for this account.</p>` : ''}
    <button class="scenario-option" type="button" data-action="set-mode" data-value="corporate"><span class="row-glyph mint">${icon('shield', 20)}</span><span><strong>Corporate</strong><small>Northstar QA · ${state.person.member ? 'Membership verified' : 'Membership required'}</small></span>${state.mode === 'corporate' ? icon('check', 18) : ''}</button>
    </div>`);
}

function pairDialog() {
  if (state.mode === 'corporate') {
    if (!state.person.member) return openDialog('Corporate access unavailable', `<p>An administrator needs to verify your organization membership before you can view or connect to corporate devices.</p>${button('admin', 'Administrator contact', 'secondary', 'mail')}`);
    return openDialog('Select a corporate device', `<p class="muted dialog-intro">Northstar QA manages which devices you can connect to.</p>${deviceRows()}`);
  }
  if (state.person.managed) return modeDialog();
  openDialog('Connect a device', `<p class="muted dialog-intro">Ask the phone owner to open Setu, start hosting, and tell you their pairing code.</p>
    <form data-form="pair" novalidate><label for="pair-code">Device pairing code</label><input id="pair-code" class="pair-code" name="code" data-autofocus type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" aria-describedby="pair-hint pair-error" placeholder="0000-XXXXXX"><p id="pair-hint" class="hint">Demo code <code>4821-K7QZPM</code> · expired example <code>4821-P3LXNV</code></p><p id="pair-error" class="error-message" role="alert" hidden></p>
      <label class="checkline"><input name="remember" type="checkbox" checked> Remember this device</label>
      <div class="button-row dialog-actions">${button('nav', 'Phone setup guide', 'quiet', 'help', 'help')}<button type="submit" class="button primary">Request connection ${icon('arrow', 17)}</button></div></form>`);
}

function deviceDialog(id) {
  const device = devices.find(entry => entry.id === id && entry.workspace === state.mode);
  if (!device || (device.workspace === 'corporate' && !state.person.member)) return;
  const connected = hasSession() && device.id === state.sessionDevice;
  const unavailable = device.access !== 'allowed';
  openDialog(device.name, `<div class="device-summary"><span class="device-glyph ${device.appearance}">${icon('phone', 24)}</span><div><strong>${safe(device.platform)}</strong><p class="muted">${safe(device.owner)} · ${device.workspace === 'corporate' ? 'Managed device' : 'Remembered phone'}</p></div></div>
    ${device.access === 'denied' ? `<p class="notice warning">${icon('lock', 18)} Northstar QA enrolled this phone. Your account is missing its device grant.</p>` : ''}
    ${device.access === 'offline' && !connected ? `<p class="notice warning">${icon('info', 18)} This phone is offline. Ask its owner to reopen Setu and check Wi-Fi.</p>` : ''}
    <div class="button-row dialog-actions">
    ${device.workspace === 'solo' && !connected ? button('forget', 'Forget device', 'quiet danger', '', id) : ''}
    ${device.access === 'denied' ? button('admin', 'Administrator contact', 'secondary', 'mail') : device.access === 'offline' && !connected ? button('resume', 'Try connection', 'primary', 'refresh', id) : ''}
    ${connected ? button('nav', 'View session', 'primary', 'arrow', 'workspace') : !unavailable ? button('resume', 'Connect device', 'primary', 'link', id) : ''}
    </div>`);
}

function captureDialog() {
  openDialog('Capture evidence', `<p class="muted dialog-intro">Create a sample capture for this workspace, then review it before sharing.</p><div class="workspace-options">
    <button type="button" class="scenario-option" data-action="snapshot"><span class="row-glyph blue">${icon('image', 20)}</span><span><strong>Simulate screenshot</strong><small>Capture the current demo screen.</small></span>${icon('chevron', 15)}</button>
    <button type="button" class="scenario-option" data-action="record-start"><span class="row-glyph lavender">${icon('video', 20)}</span><span><strong>Simulate recording</strong><small>Start a sample clip and stop when you are ready.</small></span>${icon('chevron', 15)}</button>
    </div>`);
}

function addEvidence(kind, file) {
  const kindTitle = kind === 'Screenshot' ? 'New screenshot' : 'New recording';
  const item = {
    id: `evidence-${Date.now()}`, title: file?.name || kindTitle, kind, note: '', time: dateNow(),
    device: hasSession() ? activeDevice().name : 'Imported locally', workspace: state.mode,
    visual: kind === 'Screenshot' ? 'checkout' : 'signin', file,
    url: file ? URL.createObjectURL(file) : ''
  };
  if (!file && !hasSession()) item.device = 'Sample Android device';
  state.evidence.unshift(item);
  state.view = 'evidence';
  render();
  return item.id;
}

function reviewDialog(id) {
  const item = currentEvidence().find(entry => entry.id === id);
  if (!item) return;
  state.selected = id;
  openDialog('Review evidence', `<div class="review-grid"><div>${mediaThumbnail(item, true)}${!item.file && item.kind === 'Recording' ? button('play-demo', 'Play sample clip', 'secondary', 'video') : ''}</div><form data-form="evidence">
    <p class="eyebrow">${safe(item.kind)}</p><p class="muted media-context">${safe(item.device)} · ${safe(item.time)}</p>
    <label for="evidence-title">Title</label><input id="evidence-title" name="title" value="${safe(item.title)}" required maxlength="120">
    <label for="evidence-note">What happened?</label><textarea id="evidence-note" name="note" rows="3" maxlength="650" placeholder="Add a result or describe the issue">${safe(item.note)}</textarea>
    <div class="button-row">${button('download-evidence', 'Export', 'secondary', 'inbox')}<button class="button primary" type="submit">Continue to share ${icon('arrow', 16)}</button></div>
    <button type="button" class="button quiet small" data-action="save-draft">Save draft</button></form></div>`, 'wide-dialog');
}

function storeEvidence(form) {
  if (!form.reportValidity()) return null;
  const item = currentEvidence().find(entry => entry.id === state.selected);
  if (!item) return null;
  const fields = new FormData(form);
  const title = String(fields.get('title')).trim();
  if (!title) {
    form.querySelector('#evidence-title').setCustomValidity('Enter a title.');
    form.reportValidity();
    return null;
  }
  item.title = title;
  item.note = String(fields.get('note')).trim();
  return item;
}

function shareDialog(item) {
  const managed = state.mode === 'corporate';
  openDialog('Share evidence', `<p class="dialog-intro"><strong>${safe(item.title)}</strong><br><span class="muted">${safe(item.kind)} · ${safe(item.device)}</span></p><form data-form="share"><label for="destination">Destination</label><select id="destination" name="destination"><option value="review">${managed ? 'Northstar QA review folder' : 'Personal review folder'}</option><option value="external">External link</option></select>
    <p class="hint">${managed ? 'Northstar QA allows evidence to be shared internally.' : 'Sharing is simulated in this preview.'}</p><p id="share-error" class="error-message" role="alert" hidden></p>
    <div class="button-row dialog-actions">${button('review', 'Back to review', 'secondary', '', item.id)}<button type="submit" class="button primary">Simulate sharing ${icon('arrow', 16)}</button></div></form>`);
}

function logEvent(title, detail) {
  state.events.unshift({ time: timeNow(), title, detail });
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('visible'), 3800);
}

function errorMessage(id, text, field) {
  const error = document.querySelector(`#${id}`);
  error.textContent = text;
  error.hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function startSession(id, remember = false) {
  const device = devices.find(entry => entry.id === id && entry.workspace === state.mode);
  if (!device || device.access === 'denied' || (state.mode === 'corporate' && !state.person.member) || (state.mode === 'solo' && state.person.managed)) return;
  const existing = ['pending', 'ready', 'attached', 'reconnecting', 'offline'].includes(state.phase);
  if (existing) {
    if (state.sessionDevice === id && state.mode === state.sessionMode) {
      go('workspace');
      notify('This device already has an active session.');
      return;
    }
    return openDialog('A session is already running', `<p>End the session with ${safe(activeDevice().name)} in ${state.sessionMode === 'solo' ? 'Solo' : 'Corporate'} before starting another.</p>${button('current-session', 'Open current session', 'primary', 'arrow')}`);
  }
  if (remember) state.remembered.add(id);
  state.sessionDevice = id;
  state.sessionMode = state.mode;
  state.phase = device.access === 'offline' ? 'offline' : state.mode === 'corporate' ? 'ready' : 'pending';
  state.events = [];
  logEvent(device.access === 'offline' ? 'Device offline' : state.mode === 'corporate' ? 'Encrypted tunnel ready' : 'Connection requested', device.name);
  go('workspace');
}

function endSession(reason, focus = true) {
  window.clearTimeout(reconnect.timer);
  state.history.unshift({ device: activeDevice().name, mode: state.sessionMode, reason, time: dateNow() });
  logEvent('Session ended', reason);
  state.phase = 'ended';
  state.tray = false;
  closeDialog();
  render(focus);
}

function reconnect() {
  state.phase = 'reconnecting';
  logEvent('Reconnecting', activeDevice().name);
  render(true);
  window.clearTimeout(reconnect.timer);
  reconnect.timer = window.setTimeout(() => {
    if (state.phase !== 'reconnecting') return;
    state.phase = 'offline';
    logEvent('Phone offline', 'Automatic retry timed out');
    render();
    notify('The phone is offline. Retry when it is reachable.');
  }, 3800);
}

function go(view) {
  closeDialog();
  if (!state.person) {
    state.auth = 'welcome';
  } else {
    state.tray = false;
    state.view = view;
  }
  render(true);
}

function resetScenario(key) {
  window.clearTimeout(reconnect.timer);
  for (const entry of state.evidence) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  Object.assign(state, {
    view: 'workspace', mode: 'solo', person: { name: 'Morgan Lee', email: 'morgan@example.com', member: true, managed: false },
    phase: 'attached', sessionDevice: 'pixel', sessionMode: 'solo', remembered: new Set(['pixel', 'samsung']),
    evidence: [...samples.map(item => ({ ...item }))], events: [...defaultTimeline], history: [], tray: false, background: true,
    auth: 'welcome', email: '', authFlow: 'signin', emailSent: 0, capture: false, selected: ''
  });
  closeDialog();
  if (key === 'auth') {
    state.person = null;
    state.phase = 'idle';
    state.events = [];
  }
  if (key === 'pair') {
    state.phase = 'idle';
    state.events = [];
  }
  if (['corporate', 'managed', 'denied'].includes(key)) {
    state.mode = 'corporate';
    state.sessionMode = 'corporate';
    state.sessionDevice = 'lab';
    state.phase = 'idle';
    state.events = [];
    state.person = {
      name: key === 'denied' ? 'Jamie Chen' : 'Riley Park',
      email: key === 'denied' ? 'jamie@example.com' : 'riley@northstar.example',
      member: key !== 'denied', managed: key === 'managed'
    };
  }
  if (key === 'evidence') state.view = 'evidence';
  if (key === 'reconnect') return reconnect();
  render(true);
  if (key === 'pair') pairDialog();
  if (key === 'managed') modeDialog();
}
function download(file, filename) {
  const localUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = localUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(localUrl), 10000);
}

function demoFrame(canvas, item, progress) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = item.visual === 'signin' ? '#ece1f3' : '#d8e9f7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(210, 22, 220, 316, 26);
  ctx.fill();
  ctx.fillStyle = '#e7edf5';
  ctx.fillRect(244, 187, 152, 8);
  ctx.fillRect(264, 207, 112, 8);
  ctx.fillStyle = '#263a65';
  ctx.font = '600 19px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(item.visual === 'signin' ? (progress >= 0.5 ? 'Welcome back' : 'Signing in…') : 'Order confirmed', 320, 166);
  ctx.fillStyle = item.visual === 'signin' ? '#6b4679' : '#3162ac';
  ctx.beginPath();
  ctx.arc(320, 111, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(257, 255, 126 * progress, 7);
}

async function exportEvidence(item) {
  const filename = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setu-evidence';
  if (item.file) {
    download(item.file, item.file.name);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    demoFrame(canvas, item, 1);
    if (item.kind === 'Recording' && typeof MediaRecorder !== 'undefined' && canvas.captureStream) {
      const stream = canvas.captureStream(18);
      try {
        const recorder = new MediaRecorder(stream);
        const pieces = [];
        recorder.addEventListener('dataavailable', event => pieces.push(event.data));
        const complete = new Promise((resolve, reject) => {
          recorder.addEventListener('stop', () => resolve(new Blob(pieces, { type: recorder.mimeType })), { once: true });
          recorder.addEventListener('error', reject, { once: true });
        });
        recorder.start();
        const origin = performance.now();
        const animation = setInterval(() => {
          const progress = Math.min(1, (performance.now() - origin) / 1400);
          demoFrame(canvas, item, progress);
          if (progress >= 1) {
            clearInterval(animation);
            if (recorder.state !== 'inactive') recorder.stop();
          }
        }, 60);
        const video = await complete;
        download(video, `${filename}.${video.type.includes('mp4') ? 'mp4' : 'webm'}`);
        return;
      } finally {
        stream.getTracks().forEach(track => track.stop());
      }
    } else if (item.kind === 'Screenshot') {
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (image) download(image, `${filename}.png`);
      return;
    }
    download(new Blob([`${item.title}\n${item.kind} · ${item.device}\n${item.note}`], { type: 'text/plain' }), `${filename}.txt`);
  }
}

async function copy(text, message) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    notify(message);
  } catch {
    openDialog('Copy text', `<label for="copy-text">Select and copy</label><textarea id="copy-text" data-autofocus readonly rows="4">${safe(text)}</textarea>`);
    dialog.querySelector('textarea').select();
  }
}

function signOut() {
  if (['pending', 'ready', 'attached', 'reconnecting', 'offline'].includes(state.phase)) endSession('Signed out', false);
  state.evidence.forEach(item => item.url && URL.revokeObjectURL(item.url));
  Object.assign(state, { person: null, auth: 'welcome', email: '', phase: 'idle', events: [], history: [], capture: false, evidence: samples.map(item => ({ ...item })) });
  closeDialog();
  render(true);
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.matches('input')) return;
  const { action, value } = control.dataset;
  event.preventDefault();
  switch (action) {
    case 'design': state.design = value; render(); break;
    case 'nav': go(value); break;
    case 'scenarios': scenariosDialog(); break;
    case 'scenario': resetScenario(value); break;
    case 'close': closeDialog(); break;
    case 'mode': modeDialog(); break;
    case 'set-mode':
      if (value === 'solo' && state.person.managed) return;
      state.mode = value;
      go('workspace');
      break;
    case 'pair': pairDialog(); break;
    case 'device': deviceDialog(value); break;
    case 'resume': startSession(value); break;
    case 'forget':
      openDialog('Forget this device?', `<p>Remove it from your remembered devices. You can pair it again with a fresh code.</p><div class="button-row dialog-actions">${button('close', 'Cancel', 'secondary')}${button('forget-confirm', 'Forget device', 'primary danger-fill', '', value)}</div>`);
      break;
    case 'forget-confirm':
      state.remembered.delete(value);
      go('devices');
      notify('Device removed.');
      break;
    case 'approve':
      state.phase = 'ready';
      logEvent('Phone owner approved', activeDevice().name);
      logEvent('Encrypted tunnel ready', 'Setu relay · Frankfurt');
      render(true);
      break;
    case 'decline': endSession('Phone owner declined the connection'); break;
    case 'attach':
      state.phase = 'attached';
      logEvent('ADB attached', 'Local debugger authorized');
      render(true);
      break;
    case 'current-session':
      state.mode = state.sessionMode;
      go('workspace');
      break;
    case 'disconnect':
      openDialog('Disconnect this session?', `<p>Setu will close the tunnel to <strong>${safe(activeDevice().name)}</strong> and detach its local ADB endpoint.</p><div class="button-row dialog-actions">${button('close', 'Keep session', 'secondary')}${button('end-session', 'Disconnect session', 'primary danger-fill', 'unlink')}</div>`);
      break;
    case 'end-session': endSession('You disconnected the session'); break;
    case 'background':
      state.tray = true;
      logEvent('Moved to tray', 'Session kept running');
      render(true);
      break;
    case 'restore':
      state.tray = false;
      logEvent('Workspace restored', 'Session kept running');
      render(true);
      break;
    case 'retry':
      window.clearTimeout(reconnect.timer);
      state.phase = 'ready';
      logEvent('Tunnel restored', 'Reattach your local debugger');
      render(true);
      notify('Tunnel restored. ADB can reattach.');
      break;
    case 'copy-adb': copy(command, 'ADB command copied.'); break;
    case 'copy-checklist': copy('Enable Developer options by tapping Build number seven times in About phone. Connect to Wi-Fi, enable Wireless debugging, and start hosting in Setu.', 'Phone checklist copied.'); break;
    case 'admin': openDialog('Administrator contact', `<p>Ask the Northstar QA administrator about your organization membership, enrollment, or device grant.</p><p><code>setu-admin@northstar.example</code></p>${button('copy-admin', 'Copy demo address', 'secondary', 'copy')}`); break;
    case 'copy-admin': copy('setu-admin@northstar.example', 'Administrator address copied.'); break;
    case 'diagnostic':
      openDialog('Local ADB check', `<p class="notice">${icon('terminal', 18)} Open a terminal and run <code>adb version</code>.</p><p class="muted">The preview simulates this check. It can show both the successful result and setup steps.</p><div class="button-row">${button('adb-detected', 'Simulate detected', 'secondary', 'check')}${button('adb-missing', 'Simulate missing ADB', 'secondary', 'help')}</div>`);
      break;
    case 'adb-detected': openDialog('ADB detected', `<p class="notice">${icon('check', 18)} Android Debug Bridge 1.0.41 · sample result</p><p>Once your tunnel is ready, use its local endpoint to attach your debugger.</p>`); break;
    case 'adb-missing': openDialog('ADB is unavailable', `<p>Install Android SDK Platform-Tools, add the Platform-Tools folder to your PATH, and reopen the terminal.</p>${button('nav', 'Troubleshooting', 'secondary', 'help', 'help')}`); break;
    case 'signout':
      openDialog('Sign out of Setu?', `<p>Signing out clears the active account and closes any running debug session.</p><div class="button-row dialog-actions">${button('close', 'Stay signed in', 'secondary')}${button('confirm-signout', 'Sign out', 'primary danger-fill')}</div>`);
      break;
    case 'confirm-signout': signOut(); break;
    case 'auth-intent': state.authFlow = value; state.auth = 'email'; render(true); break;
    case 'auth-back': state.auth = 'welcome'; render(true); break;
    case 'edit-email': state.auth = 'email'; render(true); break;
    case 'resend-email': {
      const remaining = Math.ceil((15000 - (Date.now() - state.emailSent)) / 1000);
      const statusLine = document.querySelector('#resend-message');
      if (remaining > 0) statusLine.textContent = `Try again in ${remaining} seconds.`;
      else {
        state.emailSent = Date.now();
        statusLine.textContent = 'Demo code refreshed.';
      }
      break;
    }
    case 'import': evidenceFile.click(); break;
    case 'capture': captureDialog(); break;
    case 'snapshot': reviewDialog(addEvidence('Screenshot')); break;
    case 'record-start':
      state.capture = true;
      openDialog('Recording sample clip', `<p class="notice warning">${icon('video', 18)} Recording in progress</p><p class="muted">Stop recording to review the sample clip.</p>${button('record-stop', 'Stop recording', 'primary danger-fill', 'video')}`);
      break;
    case 'record-stop':
      if (state.capture) {
        state.capture = false;
        reviewDialog(addEvidence('Recording'));
      }
      break;
    case 'review': reviewDialog(value); break;
    case 'play-demo': {
      const sample = dialog.querySelector('.media-preview');
      sample.classList.remove('playing');
      requestAnimationFrame(() => {
        sample.classList.add('playing');
        const label = sample.querySelector('.mock-phone strong');
        label.textContent = 'Signing in…';
        window.setTimeout(() => { label.textContent = 'Welcome back'; }, 800);
      });
      notify('Playing sample clip.');
      break;
    }
    case 'save-draft': {
      const item = storeEvidence(control.closest('form'));
      if (item) {
        go('evidence');
        notify('Evidence draft saved.');
      }
      break;
    }
    case 'download-evidence': {
      const item = storeEvidence(control.closest('form'));
      if (!item) break;
      control.disabled = true;
      exportEvidence(item).then(() => {
        go('evidence');
        notify('Evidence export ready.');
      }).catch(() => {
        control.disabled = false;
        notify('Export failed. Your draft is still available.');
      });
      break;
    }
    case 'audit-export': {
      if (state.mode !== 'corporate' || !state.person.member) break;
      const csv = value => `"${String(value).replace(/^[=+\-@]/, character => `'${character}`).replaceAll('"', '""')}"`;
      const report = [['Time', 'Event', 'Details'], ...auditRows()].map(row => row.map(csv).join(',')).join('\r\n');
      download(new Blob([report], { type: 'text/csv;charset=utf-8' }), 'setu-northstar-session-audit.csv');
      notify('Audit report exported.');
      break;
    }
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const rawCode = String(fields.get('code') || '').trim();
  const code = rawCode.replace(/[ -]/g, '');
  switch (form.dataset.form) {
    case 'email':
      state.email = String(fields.get('email')).trim().toLowerCase();
      state.auth = 'verify';
      state.emailSent = Date.now();
      render(true);
      break;
    case 'verify':
      if (!/^\d{6}$/.test(code)) return errorMessage('verify-error', 'Enter the six-digit email code.', form.elements.code);
      if (code === '000000' || Date.now() - state.emailSent > 300000) return errorMessage('verify-error', 'This email code expired. Request a new one.', form.elements.code);
      if (code !== '723190') return errorMessage('verify-error', 'That email code did not match. Try again.', form.elements.code);
      state.person = {
        name: state.email === 'riley@northstar.example' ? 'Riley Park' : state.email === 'morgan@example.com' ? 'Morgan Lee' : 'Demo account',
        email: state.email,
        member: ['morgan@example.com', 'riley@northstar.example'].includes(state.email),
        managed: state.email === 'riley@northstar.example'
      };
      state.mode = state.person.managed ? 'corporate' : 'solo';
      state.sessionMode = state.mode;
      state.phase = 'idle';
      state.events = [];
      go('workspace');
      if (state.person.managed) modeDialog();
      notify('Email verified.');
      break;
    case 'pair': {
      const pairCode = rawCode.toUpperCase().replace(/\s/g, '');
      if (!/^\d{4}-?[A-Z0-9]{6}$/.test(pairCode)) return errorMessage('pair-error', 'Enter the four digits and six characters shown on the phone.', form.elements.code);
      const normalized = pairCode.replace('-', '');
      if (normalized === '4821P3LXNV') return errorMessage('pair-error', 'This pairing code expired. Ask the phone owner for a new code.', form.elements.code);
      if (normalized !== '4821K7QZPM') return errorMessage('pair-error', 'No device was found for that code. Check the phone and try again.', form.elements.code);
      startSession('pixel-new', fields.get('remember') === 'on');
      break;
    }
    case 'evidence': {
      const item = storeEvidence(form);
      if (item) shareDialog(item);
      break;
    }
    case 'share':
      if (state.mode === 'corporate' && fields.get('destination') === 'external') return errorMessage('share-error', 'Northstar QA blocks external destinations. Your draft has been kept.', form.elements.destination);
      go('evidence');
      notify(fields.get('destination') === 'review' ? 'Shared to the sample review folder.' : 'Sample external link created.');
      break;
  }
});

document.addEventListener('input', event => {
  event.target.removeAttribute('aria-invalid');
  if (event.target.id === 'evidence-title') event.target.setCustomValidity('');
});
document.addEventListener('change', event => {
  if (event.target.dataset.action === 'tray-setting') {
    state.background = event.target.checked;
    notify(state.background ? 'Background debugging enabled.' : 'Background debugging disabled.');
  }
});

dialog.addEventListener('close', () => { if (state.capture && !dialog.open) state.capture = false; });
evidenceFile.addEventListener('change', () => {
  const file = evidenceFile.files[0];
  evidenceFile.value = '';
  if (!file) return;
  const kind = file.type.startsWith('video/') || /\.(webm|mp4|mov|m4v)$/i.test(file.name) ? 'Recording' : file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name) ? 'Screenshot' : '';
  if (!kind) {
    notify('Choose an image or a video file.');
    return;
  }
  reviewDialog(addEvidence(kind, file));
});

if (new URLSearchParams(location.search).has('design')) {
  const design = new URLSearchParams(location.search).get('design');
  if (['relay', 'signal', 'field'].includes(design)) state.design = design;
}
render();
