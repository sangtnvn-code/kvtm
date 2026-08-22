'use strict';
// =====================================================================
//  storage.js — Khu Vườn Trên Mây
//  Lưu dữ liệu trực tiếp vào ổ cứng qua File System Access API.
//  Fallback sang localStorage nếu trình duyệt không hỗ trợ.
// =====================================================================

const Storage = (() => {
  const IDB_NAME   = 'kvtm-storage';
  const IDB_STORE  = 'handles';
  const DIR_KEY    = 'saveDir';
  const FS_SUPPORTED = ('showDirectoryPicker' in window);

  let _dir = null;       // FileSystemDirectoryHandle
  let _ready = false;
  let _useFS = false;
  let _initPromise = null;

  // ── IndexedDB helpers ──────────────────────────────────────────────
  function openIDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
      req.onsuccess = e => res(e.target.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbPut(key, val) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  // ── File name sanitize ─────────────────────────────────────────────
  function keyToFile(key) {
    return key.replace(/[^a-z0-9_\-]/gi, '_') + '.json';
  }

  // ── Permission check ───────────────────────────────────────────────
  async function ensurePermission(handle) {
    try {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return true;
      perm = await handle.requestPermission({ mode: 'readwrite' });
      return perm === 'granted';
    } catch { return false; }
  }

  // ── Init — call once on game start ─────────────────────────────────
  async function init(promptIfNeeded = true) {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      if (!FS_SUPPORTED) {
        console.info('[Storage] File System API not supported → using localStorage');
        _ready = true; _useFS = false;
        return false;
      }
      try {
        // Try restoring saved handle from IndexedDB
        const saved = await idbGet(DIR_KEY);
        if (saved) {
          const ok = await ensurePermission(saved);
          if (ok) { _dir = saved; _ready = true; _useFS = true; console.info('[Storage] Dùng thư mục đã lưu:', saved.name); return true; }
        }
        // Prompt user to pick a directory
        if (!promptIfNeeded) { _ready = true; _useFS = false; return false; }
        const handle = await window.showDirectoryPicker({
          id: 'kvtm-save',
          mode: 'readwrite',
          startIn: 'documents',
        });
        await idbPut(DIR_KEY, handle);
        _dir = handle; _ready = true; _useFS = true;
        console.info('[Storage] Thư mục lưu đã chọn:', handle.name);
        return true;
      } catch (e) {
        console.warn('[Storage] Không thể dùng File System API:', e.message, '→ dùng localStorage');
        _ready = true; _useFS = false;
        return false;
      }
    })();
    return _initPromise;
  }

  // ── Re-pick directory ──────────────────────────────────────────────
  async function pickDirectory() {
    if (!FS_SUPPORTED) return false;
    try {
      const handle = await window.showDirectoryPicker({ id: 'kvtm-save', mode: 'readwrite', startIn: 'documents' });
      await idbPut(DIR_KEY, handle);
      _dir = handle; _useFS = true; _initPromise = null;
      return handle.name;
    } catch { return false; }
  }

  // ── Core API ───────────────────────────────────────────────────────
  async function save(key, value) {
    const json = JSON.stringify(value);
    if (_useFS && _dir) {
      try {
        const fh = await _dir.getFileHandle(keyToFile(key), { create: true });
        const w  = await fh.createWritable();
        await w.write(json); await w.close();
        return;
      } catch (e) { console.warn('[Storage] File write error, falling back:', e); }
    }
    localStorage.setItem(key, json);
  }

  async function load(key) {
    if (_useFS && _dir) {
      try {
        const fh   = await _dir.getFileHandle(keyToFile(key));
        const file = await fh.getFile();
        const text = await file.text();
        return JSON.parse(text);
      } catch { return null; }
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  async function remove(key) {
    if (_useFS && _dir) {
      try { await _dir.removeEntry(keyToFile(key)); return; } catch {}
    }
    localStorage.removeItem(key);
  }

  async function listKeys() {
    if (_useFS && _dir) {
      const keys = [];
      for await (const [name] of _dir.entries()) {
        if (name.endsWith('.json')) keys.push(name.slice(0, -5));
      }
      return keys;
    }
    return Object.keys(localStorage);
  }

  /** Đọc raw từng key (dùng cho admin export) */
  async function getRaw(key) {
    if (_useFS && _dir) {
      try {
        const fh   = await _dir.getFileHandle(keyToFile(key));
        const file = await fh.getFile();
        return file.text();
      } catch { return null; }
    }
    return localStorage.getItem(key);
  }
  async function setRaw(key, val) {
    if (_useFS && _dir) {
      const fh = await _dir.getFileHandle(keyToFile(key), { create: true });
      const w  = await fh.createWritable();
      await w.write(val); await w.close();
      return;
    }
    localStorage.setItem(key, val);
  }

  // ── Sync wrappers (localStorage path only, for speed) ─────────────
  // Dùng khi cần kết quả đồng bộ (trong draw loop không thể dùng await)
  function loadSync(key) {
    if (!_useFS) {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    // File system path: không thể đồng bộ, trả về null (caller phải dùng async)
    return null;
  }
  function saveSync(key, value) {
    // Luôn ghi cả localStorage như cache để loadSync hoạt động
    localStorage.setItem(key, JSON.stringify(value));
    // Async ghi file (fire and forget)
    if (_useFS) save(key, value).catch(()=>{});
  }

  return {
    init, pickDirectory,
    save, load, remove, listKeys, getRaw, setRaw,
    loadSync, saveSync,
    get isFS()    { return _useFS; },
    get isReady() { return _ready; },
    get dirName() { return _dir?.name ?? 'localStorage'; },
  };
})();
