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

  // intraday samples for the app's "day" chart, every 5 minutes
  if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) {
    const old = JSON.parse((await env.KV.get('samples')) || '[]').filter((s) => s[0] > now - 72 * 3600e3);
    old.push([now, live.g18, live.ons, live.sekee, live.usd]);
    await env.KV.put('samples', JSON.stringify(old));
  }

  const users = JSON.parse((await env.KV.get('users')) || '{}');
  let dirty = false;
  for (const [id, u] of Object.entries(users)) {
    const s = u.s || {};
    if (!u.baseline) { u.baseline = live.g18; u.lastAt = now; dirty = true; }
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
      return new Response((await env.KV.get('samples')) || '[]', {
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
        s: { intervalH: +s?.intervalH || 0, alertOn: !!s?.alertOn, pct: Math.min(20, Math.max(0.1, +s?.pct || 1)) },
        baseline: prev.baseline, lastAt: prev.lastAt || Date.now(),
      };
      await env.KV.put('users', JSON.stringify(users));
      return json({ ok: true });
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
