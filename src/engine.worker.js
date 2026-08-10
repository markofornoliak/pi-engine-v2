const decoder = new TextDecoder();
let Module = null;
let resultFileName = null;
let lastMeta = null;

async function loadEngine(threaded) {
  const file = threaded ? '../wasm/pi_engine_mt.js' : '../wasm/pi_engine_st.js';
  const createModule = (await import(file)).default;
  const base = new URL('../wasm/', import.meta.url);
  Module = await createModule({
    locateFile(path) {
      return new URL(path, base).href;
    }
  });
  return Module;
}

function heapU8() {
  return Module?.getHeapU8?.() || null;
}

function readText(ptr, length) {
  const heap = heapU8();
  if (heap) return decoder.decode(heap.subarray(ptr, ptr + length));
  if (typeof Module?.UTF8ToString === 'function') return Module.UTF8ToString(ptr, length);
  throw new Error('WASM memory interface is unavailable.');
}

async function opfsAvailable() {
  return Boolean(navigator.storage?.getDirectory);
}

async function saveFromWasm(ptr, length, digits) {
  if (!(await opfsAvailable()) || !heapU8()) return null;

  let access = null;
  try {
    const root = await navigator.storage.getDirectory();
    const name = `pi-${digits}-digits.txt`;
    const handle = await root.getFileHandle(name, { create: true });
    if (typeof handle.createSyncAccessHandle !== 'function') return null;
    access = await handle.createSyncAccessHandle();
    access.truncate(0);

    const chunkSize = 1024 * 1024;
    for (let offset = 0; offset < length; offset += chunkSize) {
      const end = Math.min(length, offset + chunkSize);
      const heap = heapU8();
      if (!heap) return null;
      const chunk = heap.slice(ptr + offset, ptr + end);
      access.write(chunk, { at: offset });
      postMessage({
        type: 'phase',
        label: 'Saving',
        progress: 92 + 7 * (end / length)
      });
    }
    access.flush();
    resultFileName = name;
    return name;
  } catch {
    return null;
  } finally {
    try { access?.close(); } catch {}
  }
}

function previewFromWasm(ptr, length) {
  if (length <= 8192) {
    const full = readText(ptr, length);
    return { first: full, last: '' };
  }

  const size = 4096;
  const heap = heapU8();
  if (heap) {
    const first = decoder.decode(heap.subarray(ptr, ptr + size));
    const last = decoder.decode(heap.subarray(ptr + length - size, ptr + length));
    return { first, last };
  }

  if (typeof Module?.UTF8ToString === 'function') {
    return {
      first: Module.UTF8ToString(ptr, size),
      last: Module.UTF8ToString(ptr + length - size, size)
    };
  }

  throw new Error('WASM memory interface is unavailable.');
}

async function compute({ digits, threads, threaded, mode }) {
  postMessage({ type: 'phase', label: 'Loading engine', progress: 2 });
  await loadEngine(threaded);

  const maxThreads = Module._pi_max_threads();
  const usedThreads = Math.max(1, Math.min(threads, maxThreads));

  postMessage({
    type: 'ready',
    engine: threaded ? 'C++ / GMP / WASM Threads' : 'C++ / GMP / WASM',
    threads: usedThreads,
    mode
  });

  postMessage({ type: 'phase', label: 'Computing π', progress: 8 });

  const started = performance.now();
  const ptr = Module._pi_compute(digits, usedThreads);
  const computeMs = performance.now() - started;

  if (!ptr) throw new Error('Native engine could not allocate enough memory.');

  const length = digits + 2;
  const preview = previewFromWasm(ptr, length);

  if (!preview.first.startsWith('3.141592653589793238462643383279')) {
    Module._pi_free(ptr);
    throw new Error('π verification failed.');
  }

  postMessage({ type: 'phase', label: 'Persisting result', progress: 92 });
  const fileName = await saveFromWasm(ptr, length, digits);

  let text = null;
  if (!fileName && length <= 20_000_002) {
    text = readText(ptr, length);
  }

  Module._pi_free(ptr);

  lastMeta = {
    digits,
    length,
    fileName,
    preview,
    computeMs,
    threads: usedThreads,
    mode,
    engine: threaded ? 'C++ / GMP / WASM Threads' : 'C++ / GMP / WASM'
  };

  postMessage({
    type: 'done',
    ...lastMeta,
    text
  });
}

async function sendFile() {
  if (!resultFileName) throw new Error('No persisted result is available.');
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(resultFileName);
  const file = await handle.getFile();
  postMessage({ type: 'file', file, name: resultFileName });
}

async function sendText() {
  if (!resultFileName) throw new Error('No persisted result is available.');
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(resultFileName);
  const file = await handle.getFile();
  const text = await file.text();
  postMessage({ type: 'text', text });
}

self.onmessage = async (event) => {
  try {
    const data = event.data;
    if (data.type === 'compute') await compute(data);
    if (data.type === 'download') await sendFile();
    if (data.type === 'copy') await sendText();
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
