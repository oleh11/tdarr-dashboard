// Tdarr dashboard: a small Plex-style status page for a Tdarr server.
// Zero dependencies. Needs Node 18+ (global fetch). Configure with environment variables, see README.md.
const http = require('http'), fs = require('fs');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => { const v = parseFloat(env(k, '')); return Number.isFinite(v) ? v : d; };
const trimSlash = s => s.replace(/\/+$/, '');

const PORT = num('PORT', 8080);
const TDARR_URL = trimSlash(env('TDARR_URL', 'http://localhost:8265'));
const TDARR_KEY = env('TDARR_KEY', '');
const RADARR_URL = trimSlash(env('RADARR_URL', ''));   // optional, used only for posters/titles
const RADARR_KEY = env('RADARR_KEY', '');
const SONARR_URL = trimSlash(env('SONARR_URL', ''));   // optional, include any URL base, e.g. http://host:8989/sonarr
const SONARR_KEY = env('SONARR_KEY', '');
const MEDIA_DIRS = env('MEDIA_DIRS', 'Movies,TVShows').split(',').map(s => s.trim()).filter(Boolean);
const TV_DIR = env('TV_DIR', 'TVShows');

// Power and cost estimate (all optional). Watts are the EXTRA draw over idle.
const RATE = num('KWH_PRICE', 0.16);                // currency per kWh
const DRIVE_PRICE = num('DRIVE_PRICE', 700);        // price of a new drive
const DRIVE_TB = num('DRIVE_TB', 24);               // its capacity in TB
const BASE_W = num('POWER_BASE_W', 60);             // per node with at least one active worker
const WORKER_W = num('POWER_PER_WORKER_W', 30);     // per active worker
const LIGHT_NODES = env('POWER_LIGHT_NODES', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LIGHT_W = num('POWER_LIGHT_NODE_W', 55);      // flat draw for nodes named in POWER_LIGHT_NODES
const ENERGY_FILE = env('ENERGY_FILE', __dirname + '/energy.json');
const PER_GB = DRIVE_PRICE / (DRIVE_TB * 1000);

const H = { 'Content-Type': 'application/json' };
if (TDARR_KEY) H['x-api-key'] = TDARR_KEY;
const T = TDARR_URL + '/api/v2/';
const post = async (p, b) => (await fetch(T + p, { method: 'POST', headers: H, body: JSON.stringify({ data: b }) })).json();

let lib = { t: 0, m: {} };
async function library() {
  if (Date.now() - lib.t < 300000) return lib.m;
  const m = {};
  const add = (list, kind) => {
    for (const x of list) {
      const p = (x.images || []).find(i => i.coverType === 'poster');
      m[(x.path || '').split('/').pop()] = {
        kind, title: x.title, year: x.year,
        poster: p && p.remoteUrl ? p.remoteUrl.replace('/original/', '/w342/') : null,
      };
    }
  };
  if (RADARR_URL && RADARR_KEY) try { add(await (await fetch(RADARR_URL + '/api/v3/movie', { headers: { 'X-Api-Key': RADARR_KEY } })).json(), 'movie'); } catch (e) {}
  if (SONARR_URL && SONARR_KEY) try { add(await (await fetch(SONARR_URL + '/api/v3/series', { headers: { 'X-Api-Key': SONARR_KEY } })).json(), 'tv'); } catch (e) {}
  lib = { t: Date.now(), m };
  return m;
}

function info(path, m) {
  const parts = path.split('/').filter(Boolean);
  const i = parts.findIndex(x => MEDIA_DIRS.includes(x));
  const folder = parts[i + 1] || '', file = parts[parts.length - 1] || '';
  const l = m[folder] || {};
  const ep = (file.match(/S\d+E\d+/) || [])[0];
  return {
    title: l.title || folder.replace(/\s*[\[(].*$/, ''),
    year: l.year || '',
    poster: l.poster || null,
    kind: l.kind || (parts[i] === TV_DIR ? 'tv' : 'movie'),
    ep: ep || '',
    res: (file.match(/(480|720|1080|2160)p/) || [])[0] || '',
  };
}

// Estimated energy, summed over time.
let E = { kwh: 0, t: Date.now() };
try { E = JSON.parse(fs.readFileSync(ENERGY_FILE, 'utf8')); } catch (e) {}
let watts = 0;
async function tickPower() {
  try {
    const nodes = await (await fetch(T + 'get-nodes', { headers: H })).json();
    let w = 0;
    for (const n of Object.values(nodes)) {
      const c = Object.keys(n.workers || {}).length;
      if (!c) continue;
      w += LIGHT_NODES.includes(String(n.nodeName).toLowerCase()) ? LIGHT_W : BASE_W + WORKER_W * c;
    }
    const now = Date.now();
    E.kwh += w * Math.min(now - E.t, 120000) / 3600000 / 1000;
    E.t = now; watts = w;
    fs.writeFileSync(ENERGY_FILE, JSON.stringify(E));
  } catch (e) {}
}
setInterval(tickPower, 30000); tickPower();

async function data() {
  const m = await library();
  const nodes = await (await fetch(T + 'get-nodes', { headers: H })).json();
  const pies = await post('stats/get-pies', { libraryId: '' });
  const files = await post('cruddb', { collection: 'FileJSONDB', mode: 'getAll' });
  const workers = [];
  for (const n of Object.values(nodes)) for (const w of Object.values(n.workers || {}))
    workers.push({ ...info(w.file || '', m), node: n.nodeName, pct: w.percentage || 0, fps: w.fps || 0, eta: w.ETA || '' });
  const list = Array.isArray(files) ? files : [];
  const queue = list.filter(f => f.TranscodeDecisionMaker === 'Queued')
    .map(f => ({ ...info(f._id, m), gb: (f.file_size || 0) / 1024 }));
  const done0 = list.filter(f => f.TranscodeDecisionMaker === 'Transcode success')
    .map(f => ({ ...info(f._id, m), gb: (f.file_size || 0) / 1024, t: f.lastTranscodeDate || 0 }))
    .filter(x => x.title !== 'media').sort((a, b) => b.t - a.t);
  const g = {};
  for (const x of done0) { const k = x.title; if (!g[k]) g[k] = { ...x, n: 0, gb: 0 }; g[k].n++; g[k].gb += x.gb; }
  const done = Object.values(g).slice(0, 24).map(x => ({ ...x, ep: x.kind === 'tv' ? x.n + ' episodes' : '' }));
  const p = pies.pieStats || {};
  const st = Object.fromEntries(((p.status || {}).transcode || []).map(x => [x.name, x.value]));
  return {
    workers, queue, done,
    doneCount: st['Transcode success'] || 0, failed: st['Transcode error'] || 0, savedGB: p.sizeDiff || 0,
    kwh: E.kwh, cost: E.kwh * RATE, perGB: PER_GB, driveTB: DRIVE_TB, drivePrice: DRIVE_PRICE, watts,
    t: Date.now(),
  };
}

http.createServer(async (req, res) => {
  if (req.url.startsWith('/data')) {
    try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await data())); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: 'upstream error' })); }
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(__dirname + '/index.html'));
  }
}).listen(PORT, env('HOST', '127.0.0.1'), () => console.log('Tdarr dashboard on port ' + PORT));
