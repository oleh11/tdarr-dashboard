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
const PC_CPU_IDLE_W = num('PC_CPU_IDLE_W', 35);       // estimated CPU draw when idle
const PC_CPU_LOAD_W = num('PC_CPU_LOAD_W', 60);       // extra CPU draw at 100% load
const PC_SYSTEM_W = num('PC_SYSTEM_W', 45);           // estimated board, RAM, fans, drives
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

let FC = null;                                  // cached full file list (it is large)
const HIST = [];                                 // finished-count samples, for the pace and time-left estimate
let PC = null;                                   // latest stats pushed by pc-stats-push.js

// Server CPU, load and disk wait, read from /proc (Linux only; hidden elsewhere)
let lastCpu = null;
function hostStats() {
  try {
    const l = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = l[3] + l[4], tot = l.reduce((a, b) => a + b, 0); let cpu = 0;
    if (lastCpu && tot > lastCpu.tot) cpu = 100 * (1 - (idle - lastCpu.idle) / (tot - lastCpu.tot));
    lastCpu = { idle, tot };
    return { cpu: Math.round(cpu), load: parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]), wait: Math.round(100 * l[4] / tot),
             cpuName: HOST_CPU, vendor: vendorOf(HOST_CPU) };
  } catch (e) { return null; }
}
let HOST_CPU = '';
try { HOST_CPU = (fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/) || [])[1] || ''; } catch (e) {}
const vendorOf = t => /nvidia|geforce|rtx|gtx|quadro/i.test(t) ? 'nvidia' : /amd|ryzen|radeon|epyc/i.test(t) ? 'amd' : /intel|xeon|arc/i.test(t) ? 'intel' : '';

// The PC reporter posts GPU/CPU numbers here. Only plain numbers and short names are kept.
function savePc(b) {
  const n = k => (Number.isFinite(+b[k]) ? +b[k] : 0), t = k => String(b[k] || '').slice(0, 80);
  PC = { t: Date.now(), gpuW: n('gpuW'), gpu: n('gpu'), enc: n('enc'), dec: n('dec'), cpu: n('cpu'), vramGB: n('vramGB'),
         gpuName: t('gpuName'), cpuName: t('cpuName'), gpuVendor: vendorOf(t('gpuName')), cpuVendor: vendorOf(t('cpuName')),
         totalW: Math.round(n('gpuW') + PC_CPU_IDLE_W + PC_CPU_LOAD_W * n('cpu') / 100 + PC_SYSTEM_W) };
}

async function data() {
  const m = await library();
  const nodes = await (await fetch(T + 'get-nodes', { headers: H })).json();
  const pies = await post('stats/get-pies', { libraryId: '' });
  if (!FC || Date.now() - FC.t > 30000) FC = { t: Date.now(), v: await post('cruddb', { collection: 'FileJSONDB', mode: 'getAll' }) };
  const files = FC.v;
  const workers = [];
  const active = new Set();                                   // files being processed right now (matched by folder/file name)
  const tail = p => String(p).split('\\').join('/').split('/').slice(-2).join('/').toLowerCase();
  for (const n of Object.values(nodes)) for (const w of Object.values(n.workers || {})) {
    active.add(tail(w.file || ''));
    workers.push({ ...info(w.file || '', m), node: n.nodeName, pct: w.percentage || 0, fps: w.fps || 0, eta: w.ETA || '' });
  }
  const list = Array.isArray(files) ? files : [];
  // Tdarr runs files with a higher "bumped" value first, then the rest; Tdarr keeps running files in the Queued state, so hide those
  const bumped = f => (typeof f.bumped === 'number' ? f.bumped : 0);
  const queue = list.filter(f => f.TranscodeDecisionMaker === 'Queued' && !active.has(tail(f._id)))
    .sort((a, b) => bumped(b) - bumped(a) || String(a._id).localeCompare(String(b._id)))
    .map(f => ({ ...info(f._id, m), gb: (f.file_size || 0) / 1024 }));
  const done0 = list.filter(f => f.TranscodeDecisionMaker === 'Transcode success')
    .map(f => ({ ...info(f._id, m), gb: (f.file_size || 0) / 1024, t: f.lastTranscodeDate || 0 }))
    .filter(x => x.title !== 'media').sort((a, b) => b.t - a.t);
  const g = {};
  for (const x of done0) { const k = x.title; if (!g[k]) g[k] = { ...x, n: 0, gb: 0 }; g[k].n++; g[k].gb += x.gb; }
  const done = Object.values(g).slice(0, 24).map(x => ({ ...x, ep: x.kind === 'tv' ? x.n + ' episodes' : '' }));
  const p = pies.pieStats || {};
  const nodeBrand = Object.fromEntries(Object.values(nodes).map(n => [n.nodeName, vendorOf(n.nodeName)]));
  const st = Object.fromEntries(((p.status || {}).transcode || []).map(x => [x.name, x.value]));
  const doneCount = st['Transcode success'] || 0, failed = st['Transcode error'] || 0;
  const left = queue.length + workers.length, total = left + doneCount + failed;
  const now = Date.now(); HIST.push({ t: now, d: doneCount }); while (HIST.length && now - HIST[0].t > 10800000) HIST.shift();
  const ref = HIST.find(h => now - h.t <= 3600000 && now - h.t >= 600000);
  const rate = ref ? (doneCount - ref.d) / ((now - ref.t) / 3600000) : 0;     // conversions per hour over the last hour
  const etaH = rate > 0.05 ? left / rate : null;
  return {
    workers, queue, done,
    doneCount, failed, left, total, rate, etaH, nodeBrand, pc: PC && Date.now() - PC.t < 30000 ? PC : null, host: hostStats(),
    savedGB: p.sizeDiff || 0,
    kwh: E.kwh, cost: E.kwh * RATE, perGB: PER_GB, driveTB: DRIVE_TB, drivePrice: DRIVE_PRICE, watts,
    t: Date.now(),
  };
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/pcstats')) {
    let b = ''; req.on('data', c => { if (b.length < 4096) b += c; });
    req.on('end', () => { try { savePc(JSON.parse(b)); res.end('ok'); } catch (e) { res.statusCode = 400; res.end('bad'); } });
    return;
  }
  if (req.url.startsWith('/data')) {
    try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await data())); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: 'upstream error' })); }
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(__dirname + '/index.html'));
  }
}).listen(PORT, env('HOST', '127.0.0.1'), () => console.log('Tdarr dashboard on port ' + PORT));
