/* Shared by the page and the service worker (classic script, no modules). */
(function (g) {
  const LIVE = 'https://call4.tgju.org/ajax.json';
  const HIST = 'https://api.tgju.org/v1/market/indicator/summary-table-data/';
  const SYMBOL = { gram18: 'geram18', ons: 'ons', sekee: 'sekee', usd: 'price_dollar_rl' };
  const DEFAULTS = { notif: false, intervalH: 0, alertOn: false, pct: 1, auto: true };

  const num = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
  const group = (n, dec = 0) =>
    n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });

  async function store(key, val) {
    const c = await caches.open('gold-state');
    const url = new Request('./__' + key);
    if (val === undefined) {
      const r = await c.match(url);
      return r ? r.json() : null;
    }
    await c.put(url, new Response(JSON.stringify(val), { headers: { 'content-type': 'application/json' } }));
  }
  const getSettings = async () => ({ ...DEFAULTS, ...((await store('settings')) || {}) });

  // Rial → toman for the Iranian prices; ounce stays in dollars.
  async function fetchLive() {
    const r = await fetch(LIVE, { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const c = (await r.json()).current;
    const pick = (k, div) => {
      const x = c[k];
      if (!x) throw new Error('missing ' + k);
      const dp = Math.abs(Number(x.dp) || 0);
      return { p: num(x.p) / div, dp, dir: x.dt === 'low' ? 'down' : 'up', t: x.ts };
    };
    return { gram18: pick('geram18', 10), ons: pick('ons', 1), sekee: pick('sekee', 10), usd: pick('price_dollar_rl', 10) };
  }

  async function fetchHistory(key) {
    const r = await fetch(HIST + SYMBOL[key], { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const rows = (await r.json()).data;
    const div = key === 'ons' ? 1 : 10;
    // newest first: [close price, jalali date]
    return rows.slice(0, 1830).map((x) => [num(x[3]) / div, x[7]]).filter((x) => x[0]);
  }

  async function notify(reg, title, body, tag) {
    await reg.showNotification(title, {
      body, tag, renotify: true, dir: 'rtl', lang: 'fa',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    });
  }

  // Decides whether a notification is due (interval and/or sudden move) and shows it.
  async function check(reg, { force = false } = {}) {
    const s = await getSettings();
    if (!s.notif && !force) return null;
    const live = await fetchLive();
    const p = live.gram18.p;
    const st = (await store('state')) || {};
    const now = Date.now();
    const line = `هر گرم ۱۸ عیار: ${fa(group(p))} تومان (${live.gram18.dir === 'down' ? '−' : '+'}${fa(live.gram18.dp.toFixed(2))}٪ امروز)`;
    let sent = false;

    if (s.alertOn && st.baseline) {
      const move = ((p - st.baseline) / st.baseline) * 100;
      if (Math.abs(move) >= s.pct) {
        await notify(reg, move > 0 ? 'طلا بالا رفت' : 'طلا پایین آمد',
          `${fa(Math.abs(move).toFixed(1))}٪ ${move > 0 ? 'افزایش' : 'کاهش'}. ${line}`, 'gold-alert');
        st.baseline = p; st.lastAt = now; sent = true;
      }
    }
    if (!sent && s.intervalH > 0 && now - (st.lastAt || 0) >= s.intervalH * 3600e3 - 60e3) {
      await notify(reg, 'قیمت طلا', line, 'gold-interval');
      st.baseline = p; st.lastAt = now; sent = true;
    }
    if (!st.baseline) st.baseline = p;
    if (!st.lastAt) st.lastAt = now;
    await store('state', st);
    return { live, sent };
  }

  g.Gold = { fetchLive, fetchHistory, check, store, getSettings, DEFAULTS, fa, group, notify };
})(typeof self !== 'undefined' ? self : window);
