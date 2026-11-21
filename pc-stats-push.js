// Optional: run this on a transcoding PC (NVIDIA GPU + nvidia-smi) to show its GPU power, GPU/CPU load
// and a rough total-power estimate on the dashboard. Needs Node 18+.
//
//   DASHBOARD_URL=http://your-server:8080 node pc-stats-push.js
//
// The dashboard must listen on an address this PC can reach (HOST=0.0.0.0).
const os = require('os'), { execFile } = require('child_process');
const URL = (process.env.DASHBOARD_URL || 'http://localhost:8080').replace(/\/+$/, '') + '/pcstats';
const EVERY = parseInt(process.env.PUSH_SECONDS || '5', 10) * 1000;
const cpuName = (os.cpus()[0] || {}).model || '';
let last = os.cpus();

function cpuPct() {
  const now = os.cpus(); let idle = 0, tot = 0;
  now.forEach((c, i) => {
    const p = last[i].times, t = c.times;
    for (const k in t) tot += t[k] - p[k];
    idle += t.idle - p.idle;
  });
  last = now;
  return tot ? 100 * (1 - idle / tot) : 0;
}

function tick() {
  const q = 'name,power.draw,utilization.gpu,utilization.encoder,utilization.decoder,memory.used';
  execFile('nvidia-smi', ['--query-gpu=' + q, '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, out) => {
    const v = err ? [] : String(out).trim().split(',').map(s => s.trim());
    const n = i => parseFloat(v[i]) || 0;
    const body = { gpuName: v[0] || '', gpuW: n(1), gpu: n(2), enc: n(3), dec: n(4), vramGB: n(5) / 1024, cpu: cpuPct(), cpuName };
    fetch(URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
  });
}
setInterval(tick, EVERY); tick();
