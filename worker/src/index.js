// Free Cloudflare Worker: stores each phone's push subscription + settings,
// checks the gold price every minute and sends Web Push (works with the app closed).
import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const num = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;
const MAX_USERS = 5;
// Iran has no daylight saving time any more: fixed UTC+3:30.
const tehranHour = (t) => new Date(t + 3.5 * 3600e3).getUTCHours();
const inQuiet = (q, t) => {
  if (!q || !q.on) return false;
  const h = tehranHour(t);
  return q.from > q.to ? h >= q.from || h < q.to : h >= q.from && h < q.to;
};

async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getLive() {
  const r = await fetch('https://call4.tgju.org/ajax.json', { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('price api ' + r.status);
  const c = (await r.json()).current;
  return {
    g18: num(c.tgju_gold_irg18.p) / 10,
    dp: Math.abs(Number(c.tgju_gold_irg18.dp) || 0),
    sign: c.tgju_gold_irg18.dt === 'low' ? '−' : '+',
    ons: num(c.ons.p), sekee: num(c.sekee.p) / 10, usd: num(c.price_dollar_rl.p) / 10,
  };
}

async function push(env, sub, msg) {
  const payload = await buildPushPayload(
    { data: JSON.stringify(msg), options: { ttl: 600, urgency: 'high' } },
    sub,
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE },
  );
  return fetch(sub.endpoint, payload);
}

const lineOf = (l) =>
  `هر گرم ۱۸ عیار: ${fa(Math.round(l.g18).toLocaleString('en-US'))} تومان (${l.sign}${fa(l.dp.toFixed(2))}٪ امروز)`;

async function tick(env, event) {
  const live = await getLive();
  const now = Date.now();

  // price history for the app's charts: every 5 min for 2 days, hourly for 60 days
  const row = [now, live.g18, live.ons, live.sekee, live.usd];
  const min = new Date(event.scheduledTime).getUTCMinutes();
  if (min % 5 === 0) {
    const m5 = JSON.parse((await env.KV.get('m5')) || '[]').filter((x) => x[0] > now - 48 * 3600e3);
    m5.push(row);
    await env.KV.put('m5', JSON.stringify(m5));
  }
  if (min === 0 || !(await env.KV.get('h1'))) {
    const h1 = JSON.parse((await env.KV.get('h1')) || '[]').filter((x) => x[0] > now - 60 * 864e5);
    h1.push(row);
    await env.KV.put('h1', JSON.stringify(h1));
  }

  const users = JSON.parse((await env.KV.get('users')) || '{}');
  let dirty = false;
  for (const [id, u] of Object.entries(users)) {
    const s = u.s || {};
    if (!u.baseline) { u.baseline = live.g18; u.lastAt = now; dirty = true; }
    if (inQuiet(s.quiet, now)) continue; // quiet hours silence everything; conditions are re-checked afterwards
    // one-shot target-price alerts
    const left = [];
    let targetSent = false;
    for (const t of s.targets || []) {
      const hit = t.dir === 'above' ? live.g18 >= t.price : live.g18 <= t.price;
      if (!hit) { left.push(t); continue; }
      const res = await push(env, u.sub, {
        title: t.dir === 'above' ? 'قیمت به هدف رسید' : 'قیمت به هدف رسید', tag: 'gold-target-' + t.id,
        body: `طلا ${t.dir === 'above' ? 'بالاتر از' : 'پایین‌تر از'} ${fa(Math.round(t.price).toLocaleString('en-US'))} تومان شد. ${lineOf(live)}`,
      }).catch(() => null);
      if (res && res.ok) { u.done = [...(u.done || []), t.id].slice(-50); targetSent = true; dirty = true; }
      else if (res && (res.status === 404 || res.status === 410)) { delete users[id]; dirty = true; break; }
      else left.push(t);
    }
    if (!users[id]) continue;
    if (targetSent) { u.s.targets = left; u.baseline = live.g18; u.lastAt = now; continue; }
    let msg = null;
    if (s.alertOn) {
      const move = ((live.g18 - u.baseline) / u.baseline) * 100;
      if (Math.abs(move) >= (s.pct || 1))
        msg = { title: move > 0 ? 'طلا بالا رفت' : 'طلا پایین آمد', tag: 'gold-alert',
          body: `${fa(Math.abs(move).toFixed(1))}٪ ${move > 0 ? 'افزایش' : 'کاهش'}. ${lineOf(live)}` };
    }
    if (!msg && s.intervalH > 0 && now - u.lastAt >= s.intervalH * 3600e3 - 30e3)
      msg = { title: 'قیمت طلا', body: lineOf(live), tag: 'gold-interval' };
    if (!msg) continue;
    const res = await push(env, u.sub, msg).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) { delete users[id]; dirty = true; continue; }
    if (res && res.ok) { u.baseline = live.g18; u.lastAt = now; dirty = true; }
  }
  if (dirty) await env.KV.put('users', JSON.stringify(users));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/samples') {
      const [m5, h1] = await Promise.all([env.KV.get('m5'), env.KV.get('h1')]);
      return new Response(`{"m5":${m5 || '[]'},"h1":${h1 || '[]'}}`, {
        headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
      });
    }

    if (req.method === 'POST' && url.pathname === '/sub') {
      const { sub, s } = await req.json().catch(() => ({}));
      if (!sub || !sub.endpoint || !sub.keys) return json({ error: 'bad subscription' }, 400);
      const users = JSON.parse((await env.KV.get('users')) || '{}');
      const id = await idOf(sub.endpoint);
      if (!users[id] && Object.keys(users).length >= MAX_USERS) return json({ error: 'full' }, 403);
      const prev = users[id] || {};
      users[id] = {
        sub,
        s: {
          intervalH: +s?.intervalH || 0, alertOn: !!s?.alertOn, pct: Math.min(20, Math.max(0.1, +s?.pct || 1)),
          quiet: { on: !!s?.quiet?.on, from: Math.min(23, Math.max(0, +s?.quiet?.from || 0)), to: Math.min(23, Math.max(0, +s?.quiet?.to || 0)) },
          targets: (Array.isArray(s?.targets) ? s.targets : []).slice(0, 10)
            .map((t) => ({ id: String(t.id).slice(0, 24), price: +t.price, dir: t.dir === 'below' ? 'below' : 'above' }))
            .filter((t) => t.price > 0 && !(prev.done || []).includes(t.id)),
        },
        baseline: prev.baseline, lastAt: prev.lastAt || Date.now(), done: prev.done || [],
      };
      await env.KV.put('users', JSON.stringify(users));
      return json({ ok: true, done: users[id].done });
    }

    if (req.method === 'POST' && url.pathname === '/unsub') {
      const { endpoint } = await req.json().catch(() => ({}));
      const users = JSON.parse((await env.KV.get('users')) || '{}');
      if (endpoint) delete users[await idOf(endpoint)];
      await env.KV.put('users', JSON.stringify(users));
      return json({ ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/test') {
      const { endpoint } = await req.json().catch(() => ({}));
      const users = JSON.parse((await env.KV.get('users')) || '{}');
      const u = endpoint && users[await idOf(endpoint)];
      if (!u) return json({ error: 'not subscribed' }, 404);
      const res = await push(env, u.sub, { title: 'قیمت طلا', body: lineOf(await getLive()), tag: 'gold-test' });
      return json({ ok: res.ok, status: res.status });
    }

    return json({ name: 'gold-worker' });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event));
  },
};
