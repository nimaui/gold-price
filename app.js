const { fetchLive, fetchHistory, check, store, getSettings, fa, group } = Gold;
const $ = (id) => document.getElementById(id);

let live = null, hist = null, samples = null, range = 'day', settings = null, reg = null, timer = null, cur = null;

/* ---------- rendering ---------- */
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shown = {};
function countTo(el, key, to, fa_) {
  const from = shown[key]; shown[key] = to;
  if (reduce || !window.gsap || from == null || from === to) { el.textContent = group(to); return; }
  const o = { v: from };
  gsap.fromTo(el, { color: to > from ? '#039874' : '#f65555' }, { color: '#252525', duration: 1.4, ease: 'power1.out', clearProps: 'color' });
  gsap.to(o, { v: to, duration: 0.8, ease: 'power2.out', onUpdate: () => (el.textContent = group(Math.round(o.v))) });
}

function renderLive() {
  const g = live.gram18;
  countTo($('price'), 'g18', g.p);
  for (const key of ['ons', 'sekee', 'usd']) {
    const row = document.querySelector(`.row[data-key=${key}]`), x = live[key];
    countTo(row.querySelector('b'), key, x.p, true);
    const chg = row.querySelector('.chg');
    chg.classList.toggle('down', x.dir === 'down');
    chg.innerHTML = `<img src="assets/arrow-${x.dir}.svg" alt="" width="9" height="${x.dir === 'down' ? 10 : 11}"><span></span>`;
    chg.lastChild.textContent = x.dp.toFixed(2).replace('.', '/') + '%';
  }
  renderHero(series());
  // Iranian prices only move while the market is open; say so instead of looking frozen.
  const ts = String(g.t || '');
  const closed = ts.endsWith('00:00:00');
  const when = closed ? 'بازار بسته است، آخرین قیمت: ' + new Date(ts.replace(' ', 'T')).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' })
    : 'آخرین تغییر قیمت: ' + ts.slice(11, 16);
  $('status').textContent = when + ' · بررسی ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' });

// Same structure as the reference app: every tab shows its own period, and the
// hero change is (now - first point of the period) / first point.
const SPAN = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
const CAPTION = { day: 'تغییرات روزانه', week: 'تغییرات هفتگی', month: 'تغییرات ماهانه', year: 'تغییرات سالانه' };
let source = 'daily';

function fromSamples() {
  if (range === 'year' || !samples) return null;
  const src = (range === 'day' ? samples.m5 : samples.h1) || [];
  const rec = src.filter((s) => s[0] > Date.now() - SPAN[range]);
  const covered = rec.length > 1 && Date.now() - rec[0][0] >= SPAN[range] * 0.85;
  if (!covered) return null;
  const keep = range === 'day' ? 96 : range === 'week' ? 84 : 120;
  const st = Math.max(1, Math.ceil(rec.length / keep));
  const out = [];
  rec.forEach((s, i) => (i % st === 0 || i === rec.length - 1) &&
    out.push({ v: s[1], label: (range === 'day' ? '' : dayLabel(s[0]) + ' ') + hhmm(s[0]) }));
  return out;
}

// [{v: price, label: text shown in the tooltip}], oldest first
function series() {
  const s = fromSamples();
  if (s) { source = 'samples'; return s; }
  source = 'daily';
  const out = [];
  if (hist) {
    const days = { day: 30, week: 7, month: 30, year: 365 }[range];
    for (let i = 0; i < days && i < hist.length; i++) out.push({ v: hist[i][0], label: hist[i][1] });
    out.reverse();
    if (live) out.push({ v: live.gram18.p, label: 'اکنون' });
  }
  return out;
}

function renderHero(pts) {
  const g = live && live.gram18; if (!g) return;
  let pct = g.dp, down = g.dir === 'down';
  if (!(range === 'day' && source === 'daily') && pts.length > 1) {
    const d = ((g.p - pts[0].v) / pts[0].v) * 100;
    pct = Math.abs(d); down = d < 0;
  }
  $('hero-pct').textContent = pct.toFixed(2) + '%';
  $('hero-change').classList.toggle('down', down);
  document.querySelector('#hero-change .cap').textContent = CAPTION[range];
}

const M = 80;
const resample = (a) => Array.from({ length: M }, (_, i) => {
  const pos = (i * (a.length - 1)) / (M - 1), k = Math.floor(pos), f = pos - k;
  return a[k] + ((a[Math.min(k + 1, a.length - 1)] - a[k]) * f);
});
let chartTween = null, introDone = false;
function intro() {
  if (introDone || reduce || !window.gsap || !cur) return;
  introDone = true;
  gsap.from('.hero > *', { y: 14, autoAlpha: 0, duration: 0.6, ease: 'power3.out', stagger: 0.09, clearProps: 'all' });
  gsap.fromTo('#chart svg', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.1, delay: 0.25, ease: 'power2.inOut', clearProps: 'clipPath' });
  gsap.from('.chart-block .range, .tabs', { autoAlpha: 0, y: 8, duration: 0.5, delay: 0.9, stagger: 0.08, clearProps: 'all' });
  gsap.from('.row', { y: 18, autoAlpha: 0, duration: 0.55, delay: 0.5, ease: 'power3.out', stagger: 0.09, clearProps: 'all' });
}

function renderChart() {
  const pts = series();
  if (pts.length < 2) return;
  renderHero(pts);
  const W = 434, H = 134, top = 45, bot = H - 5;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const prevYs = cur && cur.ys;
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
  cur = { pts, xy, W, H, ys: xy.map((p) => p[1]) };
  if (chartTween) chartTween.kill();
  if (!reduce && window.gsap && prevYs) {
    const [areaEl, lineEl] = $('chart').querySelectorAll('svg path');
    const a = resample(prevYs), b = resample(cur.ys), o = { p: 0 };
    const draw = (ys) => {
      const d = ys.map((y, i) => (i ? 'L' : 'M') + ((i / (M - 1)) * W).toFixed(1) + ' ' + y.toFixed(1)).join('');
      lineEl.setAttribute('d', d); areaEl.setAttribute('d', d + `L${W} ${H}L0 ${H}Z`);
    };
    draw(a);
    chartTween = gsap.to(o, { p: 1, duration: 0.7, ease: 'power3.out',
      onUpdate: () => draw(a.map((y, i) => y + (b[i] - y) * o.p)),
      onComplete: () => { lineEl.setAttribute('d', line); areaEl.setAttribute('d', line + `L${W} ${H}L0 ${H}Z`); } });
  }
  intro();
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
  const wasHidden = tip.hidden;
  tip.hidden = false;
  tip.querySelector('.tip-line').style.left = x + 'px';
  const dot = tip.querySelector('.tip-dot'); dot.style.left = x + 'px'; dot.style.top = y + 'px';
  bub.querySelector('b').textContent = group(cur.pts[i].v) + ' تومان';
  bub.querySelector('span').textContent = cur.pts[i].label;
  const half = bub.offsetWidth / 2;
  bub.style.left = Math.min(box.width - half - 4, Math.max(half + 4, x)) + 'px';
  bub.style.top = Math.max(y - 20, 0) + 'px';
  if (wasHidden && !reduce && window.gsap) {
    gsap.fromTo(bub, { scale: 0.85, autoAlpha: 0, transformOrigin: '50% 100%' }, { scale: 1, autoAlpha: 1, duration: 0.22, ease: 'back.out(2)' });
    gsap.fromTo(dot, { scale: 0.4 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' });
  }
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
    if (reg && !cfg().workerUrl) check(reg).catch(() => {}); // interval / threshold notifications while the app is open
  } catch {
    $('status').textContent = 'اتصال برقرار نشد. آخرین قیمت ذخیره‌شده نمایش داده می‌شود.';
  }
}

async function loadHistory() {
  try {
    const cached = JSON.parse(localStorage.getItem('hist3') || 'null');
    if (cached) { hist = cached.v; renderChart(); }
    if (!cached || Date.now() - cached.t > 6 * 3600e3) {
      hist = await fetchHistory('gram18');
      localStorage.setItem('hist3', JSON.stringify({ t: Date.now(), v: hist }));
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
    if (r.ok) { const j = await r.json(); samples = j && j.m5 ? j : null; renderChart(); }
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
    if (!reg || !('periodicSync' in reg) || cfg().workerUrl) return;
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
  $('quiet-on').checked = settings.quiet.on;
  $('quiet-from').value = String(settings.quiet.from);
  $('quiet-to').value = String(settings.quiet.to);
  renderTargets();
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

const toLatin = (v) => String(v).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, '');

function renderTargets() {
  const ul = $('targets');
  ul.innerHTML = '';
  for (const t of settings.targets) {
    const li = document.createElement('li');
    const txt = document.createElement('span');
    txt.textContent = (t.dir === 'above' ? 'بالاتر از ' : 'پایین‌تر از ') + group(t.price) + ' تومان';
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '×'; del.setAttribute('aria-label', 'حذف هدف');
    del.onclick = () => { settings.targets = settings.targets.filter((x) => x.id !== t.id); save(); renderTargets(); };
    li.append(txt, del); ul.append(li);
  }
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
      sub: sub.toJSON(), s: { intervalH: settings.intervalH, alertOn: settings.alertOn, pct: settings.pct, quiet: settings.quiet, targets: settings.targets } }) });
    if (r.ok) {
      const { done = [] } = await r.clone().json().catch(() => ({}));
      const hit = settings.targets.filter((t) => done.includes(t.id));
      if (hit.length) { settings.targets = settings.targets.filter((t) => !done.includes(t.id)); await store('settings', settings); renderTargets(); }
    }
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
  for (const id of ['quiet-from', 'quiet-to']) {
    for (let h = 0; h < 24; h++) $(id).add(new Option(String(h).padStart(2, '0') + ':00', String(h)));
  }
  $('quiet-on').onchange = (e) => { settings.quiet.on = e.target.checked; save(); };
  $('quiet-from').onchange = (e) => { settings.quiet.from = +e.target.value; save(); };
  $('quiet-to').onchange = (e) => { settings.quiet.to = +e.target.value; save(); };
  $('t-add').onclick = () => {
    const price = +toLatin($('t-price').value);
    if (!price) { $('t-price').focus(); return; }
    settings.targets.push({ id: Date.now().toString(36), price, dir: $('t-dir').value });
    $('t-price').value = ''; save(); renderTargets();
  };
  $('t-price').onfocus = () => { if (!$('t-price').value && live) $('t-price').placeholder = group(Math.round(live.gram18.p / 1e5) * 1e5); };
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
function movePill(animate) {
  const b = document.querySelector('#tabs button[aria-selected=true]'), pill = $('pill');
  if (!b) return;
  const to = { x: b.offsetLeft, y: b.offsetTop, width: b.offsetWidth };
  if (animate && !reduce && window.gsap) gsap.to(pill, { ...to, duration: 0.3, ease: 'power2.out' });
  else (window.gsap ? gsap.set(pill, to) : Object.assign(pill.style, { left: to.x + 'px', top: to.y + 'px', width: to.width + 'px' }));
}
addEventListener('resize', () => movePill(false));
document.fonts && document.fonts.ready.then(() => movePill(false));

$('tabs').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  range = b.dataset.range;
  document.querySelectorAll('#tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  movePill(true);
  renderChart();
};
document.addEventListener('visibilitychange', () => { schedule(); if (!document.hidden) { refresh(); syncPush(); } });

(async () => {
  settings = await getSettings();
  await bindSettings();
  try { live = JSON.parse(localStorage.getItem('live') || 'null'); if (live) renderLive(); } catch {}
  if ('serviceWorker' in navigator) {
    try { reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; } catch {}
  }
  await Promise.all([refresh(), loadHistory(), loadSamples()]);
  syncPeriodic(); schedule(); syncPush(); movePill(false);
})();
