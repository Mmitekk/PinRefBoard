// PinRefBoard sync pipeline — scrape both Pinterest boards, rebuild data/*.js, optionally commit.
// Usage: node tools/sync.mjs [--commit]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BOARDS = [
  { slug: 'character', id: '190699434160824795' },
  { slug: 'reference', id: '190699434160818797' },
];
const PAGE_SIZE = 25;
const DELAY_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- cookie jar ----------
function makeJar() {
  const jar = new Map();
  return {
    absorb(res) {
      for (const line of res.headers.getSetCookie?.() || []) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    get(k) {
      return jar.get(k) || '';
    },
  };
}

// ---------- html parsing ----------
function extractScript(html, id) {
  const marker = `<script id="${id}" type="application/json">`;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const end = html.indexOf('</script>', from);
  if (end === -1) return null;
  try {
    return JSON.parse(html.slice(from, end));
  } catch {
    return null;
  }
}

function mapPin(raw, board) {
  const imgs = raw.images || {};
  const pick = (k) => (imgs[k] ? { u: imgs[k].url, w: imgs[k].width, h: imgs[k].height } : null);
  const any = imgs['474x'] || imgs['236x'] || imgs['736x'] || imgs.orig;
  if (!any) return null;
  return {
    id: String(raw.id),
    board,
    title: raw.grid_title || '',
    description: raw.description || '',
    color: raw.dominant_color || '#808080',
    img: { small: pick('236x'), medium: pick('474x'), large: pick('736x'), orig: pick('orig') },
    link: 'https://www.pinterest.com/pin/' + raw.id + '/',
  };
}

function existingIds(slug) {
  const file = path.join(DATA_DIR, slug + '.js');
  if (!fs.existsSync(file)) return new Set();
  try {
    const m = fs.readFileSync(file, 'utf8').match(/= (\[[\s\S]*\]);\s*$/);
    const arr = JSON.parse(m[1]);
    return new Set(arr.map((p) => p.id));
  } catch {
    return new Set();
  }
}

// ---------- scraping ----------
async function scrapeBoard({ slug, id }) {
  const jar = makeJar();
  const pageRes = await fetch(`https://ru.pinterest.com/mmitekk/${slug}/`, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  });
  jar.absorb(pageRes);
  const html = await pageRes.text();
  const pwsData = extractScript(html, '__PWS_DATA__') || {};
  const appVersion = pwsData.appVersion || '';
  const csrf = jar.get('csrftoken');
  const boardUrl = `/mmitekk/${slug}/`;

  const pins = new Map();
  let bookmarks = [];
  let pages = 0;

  while (true) {
    const dataObj = { options: { board_id: id, board_url: boardUrl, page_size: PAGE_SIZE, bookmarks }, context: {} };
    const url = 'https://www.pinterest.com/resource/BoardFeedResource/get/?source_url=' + encodeURIComponent(boardUrl) +
      '&data=' + encodeURIComponent(JSON.stringify(dataObj));
    let json = null;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            accept: 'application/json, text/javascript, */*, q=0.01',
            cookie: jar.header(),
            'user-agent': UA,
            'x-app-version': appVersion,
            'x-csrf-token': csrf,
            'x-pinterest-appstate': 'active',
            'x-pinterest-pws-handler': 'www/board/[username]/[slug].js',
            'x-pinterest-source-url': boardUrl,
            'x-requested-with': 'XMLHttpRequest',
            referer: 'https://ru.pinterest.com' + boardUrl,
          },
        });
        jar.absorb(res);
        if (res.status === 429 || res.status === 403 || res.status === 401) {
          console.log(`  [${slug}] http ${res.status}, retry in ${3000 * (attempt + 1)}ms`);
          await sleep(3000 * (attempt + 1));
          continue;
        }
        json = await res.json();
        ok = true;
      } catch (e) {
        console.log(`  [${slug}] fetch error: ${e.message}, retry`);
        await sleep(2000);
      }
    }
    if (!ok) throw new Error(`[${slug}] resource API unavailable after retries`);

    const arr = json?.resource_response?.data || [];
    for (const raw of arr) {
      if (raw && raw.type === 'pin' && raw.id) {
        const p = mapPin(raw, slug);
        if (p && !pins.has(p.id)) pins.set(p.id, p);
      }
    }
    pages++;
    const next = json?.resource?.options?.bookmarks || [];
    const end = !next.length || next[0] === '-end-';
    console.log(`  [${slug}] page ${pages}: total ${pins.size}`);
    if (end || arr.length === 0) break;
    bookmarks = next;
    await sleep(DELAY_MS);
  }
  return [...pins.values()];
}

// ---------- build & commit ----------
function writeDataFiles(pinsByBoard) {
  const changed = [];
  for (const [slug, pins] of Object.entries(pinsByBoard)) {
    // deterministic content (no timestamp!) — иначе каждый синк даёт пустой коммит
    const js = `// generated by tools/sync.mjs — ${pins.length} pins from pinterest.com/mmitekk/${slug}\n` +
      'window.__PINS_' + slug.toUpperCase() + ' = ' + JSON.stringify(pins) + ';\n';
    const file = path.join(DATA_DIR, slug + '.js');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== js) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, js);
      changed.push(slug);
    }
  }
  return changed;
}

function tryCommit(added, removed) {
  try {
    const status = execSync('git status --porcelain -- data', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!status) return false;
    execSync('git add data', { cwd: ROOT });
    execSync(`git commit -m "sync: +${added} -${removed} (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)"`, { cwd: ROOT });
    return true;
  } catch (e) {
    console.log('commit skipped: ' + (e.message || e));
    return false;
  }
}

// ---------- entry ----------
export async function runSync({ commit = false } = {}) {
  const oldIds = {};
  for (const b of BOARDS) oldIds[b.slug] = existingIds(b.slug);

  console.log('sync: scraping ' + BOARDS.length + ' boards...');
  const results = await Promise.all(BOARDS.map((b) => scrapeBoard(b)));

  const pinsByBoard = {};
  let added = 0;
  let removed = 0;
  const totals = {};
  for (let i = 0; i < BOARDS.length; i++) {
    const slug = BOARDS[i].slug;
    pinsByBoard[slug] = results[i];
    totals[slug] = results[i].length;
    const ids = new Set(results[i].map((p) => p.id));
    for (const id of ids) if (!oldIds[slug].has(id)) added++;
    for (const id of oldIds[slug]) if (!ids.has(id)) removed++;
  }

  const changed = writeDataFiles(pinsByBoard);
  const committed = commit && changed.length ? tryCommit(added, removed) : false;

  const summary = { ok: true, added, removed, totals, changed, committed };
  console.log('sync done: ' + JSON.stringify({ ...summary, pins: undefined }));
  return { ...summary, pins: pinsByBoard };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSync({ commit: process.argv.includes('--commit') })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('sync failed: ' + (e.message || e));
      process.exit(1);
    });
}
