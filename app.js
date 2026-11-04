const { fetchLive, fetchHistory, check, store, getSettings, fa, group } = Gold;
const $ = (id) => document.getElementById(id);

const RANGES = { day: [30, 1], week: [12, 7], month: [12, 30], year: [60, 30] }; // [points, step in days]
let live = null, hist = null, samples = null, range = 'day', settings = null, reg = null, timer = null, cur = null;

/* ---------- rendering ---------- */
function renderLive() {
  const g = live.gram18;
  $('price').textContent = group(g.p);
  $('hero-pct').textContent = g.dp.toFixed(2) + '%';
  $('hero-change').classList.toggle('down', g.dir === 'down');
  for (const key of ['ons', 'sekee', 'usd']) {
    const row = document.querySelector(`.row[data-key=${key}]`), x = live[key];
    row.querySelector('b').textContent = group(x.p);
    const chg = row.querySelector('.chg');
    chg.classList.toggle('down', x.dir === 'down');
    chg.innerHTML = `<img src="assets/arrow-${x.dir}.svg" alt="" width="9" height="${x.dir === 'down' ? 10 : 11}"><span></span>`;
    chg.lastChild.textContent = x.dp.toFixed(2).replace('.', '/') + '%';
  }
  $('status').textContent = 'به‌روز شد ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' });

// [{v: price, label: text shown in the tooltip}], oldest first
function series() {
  const out = [];
  const dayFromSamples = range === 'day' && samples && samples.filter((s) => s[0] > Date.now() - 864e5).length >= 8;
  if (dayFromSamples) {
    const rec = samples.filter((s) => s[0] > Date.now() - 864e5);
    const stepN = Math.max(1, Math.ceil(rec.length / 120));
    rec.forEach((s, i) => (i % stepN === 0 || i === rec.length - 1) && out.push({ v: s[1], label: hhmm(s[0]) }));
  } else if (hist) {
    const [n, step] = RANGES[range];
    for (let i = 0; i < n && i * step < hist.length; i++) out.push({ v: hist[i * step][0], label: hist[i * step][1] });
    out.reverse();
    if (live) out.push({ v: live.gram18.p, label: 'اکنون' });
  }
  return out;
}

function renderChart() {
  const pts = series();
  if (pts.length < 2) return;
  const W = 434, H = 134, top = 45, bot = H - 5;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = vs.map((v, i) => [(i / (pts.length - 1)) * W, bot - ((v - lo) / span) * (bot - top)]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  $('chart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="g" x1="0" y1="${top}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FAB819"/><stop offset="1" stop-color="#FFD88E" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L${W} ${H}L0 ${H}Z" fill="url(#g)" fill-opacity=".1"/>
      <path d="${line}" fill="none" stroke="#EFBD3B" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>
    <div class="tip" hidden>
      <div class="tip-line"></div><div class="tip-dot"></div>
      <div class="tip-bubble"><b></b><span></span></div>
    </div>`;
  cur = { pts, xy, W, H };
  $('lo').textContent = group(lo);
  $('hi').textContent = group(hi);
}

/* ---------- tooltip on tap / drag ---------- */
function showTip(clientX) {
  if (!cur) return;
  const box = $('chart').getBoundingClientRect();
  const rel = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  const i = Math.round(rel * (cur.pts.length - 1));
  const x = (cur.xy[i][0] / cur.W) * box.width, y = (cur.xy[i][1] / cur.H) * box.height;
  const tip = $('chart').querySelector('.tip'), bub = tip.querySelector('.tip-bubble');
  tip.hidden = false;
  tip.querySelector('.tip-line').style.left = x + 'px';
  const dot = tip.querySelector('.tip-dot'); dot.style.left = x + 'px'; dot.style.top = y + 'px';
  bub.querySelector('b').textContent = group(cur.pts[i].v) + ' تومان';
  bub.querySelector('span').textContent = cur.pts[i].label;
  const half = bub.offsetWidth / 2;
  bub.style.left = Math.min(box.width - half - 4, Math.max(half + 4, x)) + 'px';
  bub.style.top = Math.max(y - 20, 0) + 'px';
}
const chartEl = $('chart');
chartEl.addEventListener('pointerdown', (e) => { chartEl.setPointerCapture(e.pointerId); showTip(e.clientX); });
chartEl.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') showTip(e.clientX); });
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#chart')) { const t = chartEl.querySelector('.tip'); if (t) t.hidden = true; }
});

/* ---------- data ---------- */
async function refresh() {
  try {
    live = await fetchLive();
    renderLive();
    renderChart();
    localStorage.setItem('live', JSON.stringify(live));
    const st = (await store('state')) || {};
    if (!st.baseline) { st.baseline = live.gram18.p; st.lastAt = Date.now(); await store('state', st); }
    if (reg) check(reg).catch(() => {}); // interval / threshold notifications while the app is open
  } catch {
    $('status').textContent = 'اتصال برقرار نشد. آخرین قیمت ذخیره‌شده نمایش داده می‌شود.';
  }
}

async function loadHistory() {
  try {
    const cached = JSON.parse(localStorage.getItem('hist2') || 'null');
    if (cached) { hist = cached.v; renderChart(); }
    if (!cached || Date.now() - cached.t > 6 * 3600e3) {
      hist = await fetchHistory('gram18');
      localStorage.setItem('hist2', JSON.stringify({ t: Date.now(), v: hist }));
      renderChart();
    }
  } catch { /* chart keeps cached data */ }
}

// Intraday samples written every ~5 min by the GitHub Action (data branch).
function samplesUrl() {
  const w = cfg().workerUrl;
  return w ? w + '/samples' : '';
}
async function loadSamples() {
  const u = samplesUrl(); if (!u) return;
  try {
    const r = await fetch(u, { cache: 'no-cache' });
    if (r.ok) { samples = await r.json(); renderChart(); }
  } catch { /* falls back to daily closes */ }
}

function schedule() {
  clearInterval(timer);
  if (settings.auto && !document.hidden) timer = setInterval(refresh, 120e3);
}

/* ---------- settings ---------- */
async function save() {
  await store('settings', settings); syncPeriodic(); schedule(); syncPush();
}

async function syncPeriodic() {
  // Background checks on installed Chrome/Android PWAs. iOS ignores this.
  try {
    if (!reg || !('periodicSync' in reg)) return;
    if (settings.notif && (settings.intervalH > 0 || settings.alertOn)) {
      const h = settings.alertOn ? 1 : settings.intervalH;
      await reg.periodicSync.register('gold-check', { minInterval: h * 3600e3 });
    } else await reg.periodicSync.unregister('gold-check');
  } catch { /* permission not granted yet */ }
}

const isIOS = () => /iphone|ipad/i.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function paintSettings() {
  $('notif-on').checked = settings.notif;
  $('interval').value = String(settings.intervalH);
  $('alert-on').checked = settings.alertOn;
  $('pct-out').textContent = String(settings.pct).replace('.', '/');
  $('auto-on').checked = settings.auto;
  $('sheet').classList.toggle('no-notif', !settings.notif);
  $('notif-hint').textContent =
    !('Notification' in window) || (isIOS() && !isStandalone())
      ? 'برای اعلان، ابتدا از منوی اشتراک‌گذاری «Add to Home Screen» را بزنید و برنامه را از صفحه اصلی باز کنید.'
      : Notification.permission === 'denied'
        ? 'اعلان‌ها در تنظیمات گوشی بسته شده‌اند. اجازه را از تنظیمات باز کنید.'
        : 'بدون اعلان ابری، اعلان فقط وقتی برنامه باز یا تازه در پس‌زمینه است می‌آید.';
  if (!cfg().workerUrl) $('push-hint').textContent = 'سرور اعلان هنوز راه‌اندازی نشده است.';
  else if (!settings.notif) $('push-hint').textContent = 'اعلان را روشن کنید تا خودکار فعال شود.';
}

function openSheet(open) {
  $('sheet').classList.toggle('open', open);
  $('sheet').setAttribute('aria-hidden', String(!open));
  $('scrim').hidden = !open;
  if (open) { paintSettings(); $('close-settings').focus(); } else $('open-settings').focus();
}

const b64ToU8 = (s) => {
  const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

// Sends the phone's push subscription and settings to the free Cloudflare Worker, automatically.
const cfg = () => window.GOLD_CONFIG || {};
async function syncPush() {
  const { vapidPublicKey: key, workerUrl } = cfg();
  if (!reg || !key || !workerUrl || !('PushManager' in window)) return false;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!settings.notif || Notification.permission !== 'granted') {
      if (sub) { await fetch(workerUrl + '/unsub', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      return false;
    }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    const r = await fetch(workerUrl + '/sub', { method: 'POST', body: JSON.stringify({
      sub: sub.toJSON(), s: { intervalH: settings.intervalH, alertOn: settings.alertOn, pct: settings.pct } }) });
    $('push-hint').textContent = r.ok ? 'فعال است. قیمت حتی وقتی برنامه بسته است می‌رسد.' : 'اتصال به سرور اعلان برقرار نشد.';
    return r.ok;
  } catch {
    $('push-hint').textContent = 'اعلان ابری فعال نشد. اتصال اینترنت را بررسی کنید.';
    return false;
  }
}

async function bindSettings() {
  $('open-settings').onclick = () => openSheet(true);
  $('close-settings').onclick = $('scrim').onclick = () => openSheet(false);
  addEventListener('keydown', (e) => e.key === 'Escape' && openSheet(false));

  $('notif-on').onchange = async (e) => {
    if (e.target.checked) {
      const perm = 'Notification' in window ? await Notification.requestPermission() : 'denied';
      settings.notif = perm === 'granted';
    } else settings.notif = false;
    await save(); paintSettings();
  };
  $('interval').onchange = (e) => { settings.intervalH = +e.target.value; save(); };
  $('alert-on').onchange = (e) => { settings.alertOn = e.target.checked; save(); };
  $('auto-on').onchange = (e) => { settings.auto = e.target.checked; save(); };
  document.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
    settings.pct = Math.min(20, Math.max(0.5, settings.pct + +b.dataset.step));
    $('pct-out').textContent = String(settings.pct).replace('.', '/'); save();
  });
  $('test-notif').onclick = async () => {
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub && cfg().workerUrl) { // real end-to-end test through the server
      fetch(cfg().workerUrl + '/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      return;
    }
    const l = live || await fetchLive();
    Gold.notify(reg, 'قیمت طلا', `هر گرم ۱۸ عیار: ${fa(group(l.gram18.p))} تومان`, 'gold-test');
  };
}

/* ---------- boot ---------- */
$('tabs').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  range = b.dataset.range;
  document.querySelectorAll('#tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderChart();
};
document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) refresh(); });

(async () => {
  settings = await getSettings();
  await bindSettings();
  try { live = JSON.parse(localStorage.getItem('live') || 'null'); if (live) renderLive(); } catch {}
  if ('serviceWorker' in navigator) {
    try { reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; } catch {}
  }
  await Promise.all([refresh(), loadHistory(), loadSamples()]);
  syncPeriodic(); schedule(); syncPush();
})();
