// PinRefBoard local sync helper — serves the sync pipeline to the site's sync button.
// Listens on 127.0.0.1, first free port from 8924. Allowed origins: the GitHub Pages site + local preview.
// Run: node tools/sync-server.mjs
import http from 'node:http';
import { runSync } from './sync.mjs';

const BASE_PORT = 8924;
const VERSION = 2; // bump when sync-server logic changes — the site picks the helper with the highest version
const ALLOWED_ORIGINS = [
  'https://mmitekk.github.io',
  'http://127.0.0.1:8923',
  'http://localhost:8923',
  'null', // file:// pages
];

let syncing = false;

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
}

async function handle(req, res) {
  const origin = String(req.headers.origin || '');
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    if (ALLOWED_ORIGINS.includes(origin)) {
      cors(res, origin || '*');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.writeHead(204).end();
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
    return;
  }
  cors(res, origin || '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');

  if (url === '/ping') {
    res.writeHead(200).end(JSON.stringify({ ok: true, helper: 'pinref-sync', v: VERSION, ready: !syncing }));
    return;
  }

  if (url === '/sync') {
    if (syncing) {
      res.writeHead(409).end(JSON.stringify({ ok: false, error: 'sync already running' }));
      return;
    }
    syncing = true;
    console.log('[' + new Date().toLocaleTimeString() + '] sync requested from ' + origin);
    try {
      const result = await runSync({ commit: true });
      console.log('[' + new Date().toLocaleTimeString() + '] done: +' + result.added + ' -' + result.removed + ', committed=' + result.committed);
      res.writeHead(200).end(JSON.stringify(result));
    } catch (e) {
      console.error('sync failed: ' + (e.message || e));
      res.writeHead(500).end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    } finally {
      syncing = false;
    }
    return;
  }

  res.writeHead(404).end(JSON.stringify({ ok: false, error: 'not found' }));
}

function listen(port, attemptsLeft) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((e) => {
      try { res.writeHead(500).end(JSON.stringify({ ok: false, error: String(e.message || e) })); } catch {}
    });
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log('port ' + port + ' busy (maybe a stale helper) — trying ' + (port + 1));
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('cannot listen: ' + e.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('PinRefSync helper v' + VERSION + ': http://127.0.0.1:' + port + ' (ping/sync)');
    console.log('allowed origins: ' + ALLOWED_ORIGINS.join(', '));
  });
}

listen(BASE_PORT, 6);
