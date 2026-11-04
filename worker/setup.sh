#!/usr/bin/env bash
# One-time setup: creates the free KV store, VAPID keys, deploys the worker, writes config.js.
set -euo pipefail
cd "$(dirname "$0")"
npm install --silent

npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

# KV namespace
if grep -q REPLACE_ME wrangler.toml; then
  ID=$(npx wrangler kv namespace create KV 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)
  [ -n "$ID" ] || { echo "could not create KV namespace"; exit 1; }
  sed -i.bak "s/REPLACE_ME/$ID/" wrangler.toml && rm wrangler.toml.bak
fi

# VAPID keys: the private key goes straight into Cloudflare, never to a file
KEYS=$(node -e "
const c=require('crypto');const {privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const j=privateKey.export({format:'jwk'});const b=(s)=>s;
const pub=Buffer.concat([Buffer.from([4]),Buffer.from(j.x,'base64url'),Buffer.from(j.y,'base64url')]).toString('base64url');
console.log(pub+' '+j.d)")
PUB=${KEYS% *}; PRIV=${KEYS#* }
if [ ! -f .vapid-done ]; then
  printf '%s' "$PRIV" | npx wrangler secret put VAPID_PRIVATE >/dev/null
  printf '%s' "$PUB"  | npx wrangler secret put VAPID_PUBLIC  >/dev/null
  echo "$PUB" > .vapid-done
fi
PUB=$(cat .vapid-done)

URL=$(npx wrangler deploy 2>&1 | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "deploy failed"; exit 1; }

cat > ../config.js <<E
// Filled in automatically by worker/setup.sh
window.GOLD_CONFIG = {
  vapidPublicKey: '$PUB',
  workerUrl: '$URL',
};
E
echo "Done. Worker: $URL"
