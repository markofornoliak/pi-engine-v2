const $ = (id) => document.getElementById(id);
const digits = $('digits');
const mode = $('mode');
const start = $('start');
const stop = $('stop');
const save = $('save');
const copy = $('copy');
const status = $('status');
const bar = $('bar');
const percent = $('percent');
const elapsed = $('elapsed');
const speed = $('speed');
const engine = $('engine');
const threads = $('threads');
const output = $('output');
const device = $('device');

let worker = null;
let timer = null;
let startedAt = 0;
let currentDigits = 0;
let lastText = null;

const fmt = (n) => Number(n).toLocaleString('en-US');

function detectDevice() {
  const cores = Math.max(1, navigator.hardwareConcurrency || 1);
  const isolated = window.crossOriginIsolated === true;
  const shared = isolated && typeof SharedArrayBuffer !== 'undefined';
  const opfs = Boolean(navigator.storage?.getDirectory);
  return { cores, isolated, shared, opfs };
}

function selection(profile, selectedMode) {
  if (selectedMode === 'safe') return { threaded: false, threads: 1 };
  if (!profile.shared || profile.cores < 2) return { threaded: false, threads: 1 };
  if (selectedMode === 'fast') return { threaded: true, threads: Math.min(4, profile.cores) };
  return { threaded: true, threads: Math.min(8, profile.cores) };
}

function renderDevice() {
  const p = detectDevice();
  device.textContent = `${p.cores} cores · ${p.shared ? 'shared memory' : 'single-memory'} · ${p.opfs ? 'OPFS' : 'no OPFS'}`;
}

function setProgress(value, label) {
  const p = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${p}%`;
  percent.textContent = `${Math.round(p)}%`;
  if (label) status.textContent = label;
}

function setBusy(busy) {
  start.disabled = busy;
  stop.disabled = !busy;
  digits.disabled = busy;
  mode.disabled = busy;
}

function killWorker() {
  worker?.terminate();
  worker = null;
  clearInterval(timer);
}

function preview(first, last, totalDigits) {
  if (totalDigits <= 8000) return first;
  return `${first}\n\n… ${fmt(totalDigits - 8000)} digits hidden …\n\n${last}`;
}

function fail(message) {
  killWorker();
  setBusy(false);
  status.textContent = 'Error';
  output.textContent = message;
}

async function run() {
  const n = Number(digits.value);
  if (!Number.isSafeInteger(n) || n < 1) {
    fail('Enter a positive integer.');
    return;
  }

  currentDigits = n;
  lastText = null;
  const profile = detectDevice();
  const config = selection(profile, mode.value);

  killWorker();
  worker = new Worker('./src/engine.worker.js', { type: 'module' });
  setBusy(true);
  save.disabled = true;
  copy.disabled = true;
  engine.textContent = 'Loading';
  threads.textContent = '—';
  output.textContent = 'Computing…';
  setProgress(0, 'Starting');
  startedAt = performance.now();

  timer = setInterval(() => {
    const seconds = (performance.now() - startedAt) / 1000;
    elapsed.textContent = `${seconds.toFixed(2)} s`;
  }, 100);

  worker.onmessage = (event) => {
    const data = event.data;

    if (data.type === 'phase') {
      setProgress(data.progress, data.label);
      return;
    }

    if (data.type === 'ready') {
      engine.textContent = data.engine;
      threads.textContent = data.threads;
      return;
    }

    if (data.type === 'done') {
      clearInterval(timer);
      const totalSeconds = (performance.now() - startedAt) / 1000;
      elapsed.textContent = `${totalSeconds.toFixed(2)} s`;
      speed.textContent = `${fmt(Math.round(currentDigits / Math.max(data.computeMs / 1000, 0.001)))} digits/s`;
      engine.textContent = data.engine;
      threads.textContent = data.threads;
      output.textContent = preview(data.preview.first, data.preview.last, data.digits);
      lastText = data.text;
      setProgress(100, 'Done');
      setBusy(false);
      save.disabled = !data.fileName && !data.text;
      copy.disabled = !data.fileName && !data.text;
      return;
    }

    if (data.type === 'file') {
      const url = URL.createObjectURL(data.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    if (data.type === 'text') {
      navigator.clipboard.writeText(data.text).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 900);
      });
      return;
    }

    if (data.type === 'error') fail(data.message);
  };

  worker.onerror = (event) => fail(event.message || 'Worker failed.');
  worker.postMessage({
    type: 'compute',
    digits: n,
    mode: mode.value,
    threaded: config.threaded,
    threads: config.threads
  });
}

start.addEventListener('click', run);
stop.addEventListener('click', () => {
  killWorker();
  setBusy(false);
  status.textContent = 'Stopped';
  output.textContent = 'Stopped.';
});

save.addEventListener('click', () => {
  if (lastText) {
    const blob = new Blob([lastText, '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pi-${currentDigits}-digits.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    worker?.postMessage({ type: 'download' });
  }
});

copy.addEventListener('click', () => {
  if (lastText) navigator.clipboard.writeText(lastText);
  else worker?.postMessage({ type: 'copy' });
});

renderDevice();
