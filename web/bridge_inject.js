// ===== ComfyUI embed bridge + ledger sync =====
// Injected into the vendored page (Danbooru-Tag-Selector.html) by
// sync_upstream.py. Runs in three contexts:
//   - inside the ComfyUI floaty (IN_FRAME): text sync via postMessage +
//     ledger sync via the plugin's HTTP routes
//   - opened as a local file (file:): ledger sync via File System Access
//   - opened over http directly: same as local file, but the picker is for
//     the ledger JSON only
// It relies on names from the host page's main script scope ($, toast,
// Storage, Candidate, Favorites, DATA), so keep it injected at the tail of
// that same <script> block.
(function () {
  var IN_FRAME = window.parent !== window;
  if (!IN_FRAME && location.protocol !== 'file:') return;

  // ---------- text sync (only meaningful inside the floaty) ----------
  var hostOrigin = null;
  var timer = null;
  function send(type, extra) {
    var target = hostOrigin || '*';
    try { window.parent.postMessage(Object.assign({ type: type }, extra || {}), target); } catch (err) {}
  }
  function broadcast(text) {
    clearTimeout(timer);
    timer = setTimeout(function () { send('dts_text_changed', { text: text }); }, 120);
  }
  if (IN_FRAME) {
    // The tool updates the textarea through internal module channels we
    // cannot wrap, so poll the textarea itself. Node text arriving before
    // the dataset is loaded is held back: initData wipes the candidate
    // area, so we only apply it once DATA is populated.
    var lastSentText = null;
    var pendingNodeText = null;
    function applyPending(ta) {
      var t = pendingNodeText;
      pendingNodeText = null;
      lastSentText = t;
      if (ta.value !== t) {
        ta.value = t;
        Candidate.commitCandText();
      }
    }
    function pollText() {
      var ta = $('candText');
      if (!ta) return;
      if (pendingNodeText !== null) {
        if (typeof DATA !== 'undefined' && DATA && DATA.length) {
          applyPending(ta);
        }
        return;
      }
      if (ta.value !== lastSentText) {
        lastSentText = ta.value;
        broadcast(ta.value);
      }
    }
    setInterval(pollText, 400);
    var candTa = $('candText');
    if (candTa) candTa.addEventListener('input', pollText);
    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data.type !== 'string' || e.data.type.lastIndexOf('dts_', 0) !== 0) return;
      hostOrigin = e.origin;
      if (e.data.type === 'dts_set_text') {
        pendingNodeText = e.data.text || '';
        lastSentText = null;
        pollText();
      } else if (e.data.type === 'dts_get_text') {
        send('dts_text', { text: Candidate.buildText() });
      } else if (e.data.type === 'dts_load_dataset') {
        if (typeof e.data.url !== 'string' || !e.data.url) return;
        fetch(e.data.url)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function (text) {
            if (typeof Papa === 'undefined') { toast('PapaParse 未加载，无法解析内置数据集'); return; }
            parseCSV(text);
          })
          .catch(function (err) { toast('内置数据集加载失败: ' + err.message); });
      }
    });
    send('dts_ready');

    // report the page theme so the host can tint the window chrome to match
    function reportTheme() {
      send('dts_theme', { theme: document.documentElement.getAttribute('data-theme') || 'dark' });
    }
    reportTheme();
    new MutationObserver(reportTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  // ---------- ledger sync ----------
  // mode: embedded in the floaty -> HTTP route; opened as a local file ->
  // File System Access handle on data/dts_data.json directly.
  // The tool's own db helpers live inside the Storage module closure, so we
  // open the same IndexedDB database ourselves instead of reaching in.
  var MODE = IN_FRAME ? 'api' : 'fs';
  var API_BASE = '/tag_selector/data';
  var fsHandle = null;
  var lastSnapStr = null;
  var pushTimer = null;
  var LEDGER_DB_NAME = 'DanbooruTagSelectorDB';
  var STORE_FAVS = 'favorites';
  var STORE_HIST = 'history';
  var _rawDbP = null;

  function getRawDb() {
    if (!_rawDbP) {
      _rawDbP = new Promise(function (res, rej) {
        var rq = indexedDB.open(LEDGER_DB_NAME);   // no version: never trigger upgrades
        rq.onsuccess = function () {
          rq.result.onclose = function () { _rawDbP = null; };
          res(rq.result);
        };
        rq.onerror = function () { rej(rq.error); };
      });
    }
    return _rawDbP;
  }
  function rawGetAll(store) {
    return getRawDb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(store, 'readonly').objectStore(store).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function rawPutAll(store, items) {
    return getRawDb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(store, 'readwrite');
        var os = tx.objectStore(store);
        (items || []).forEach(function (it) { os.put(it); });
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  async function dumpState() {
    var out = { favs: [], history: [], ls: {} };
    try { out.favs = await rawGetAll(STORE_FAVS); } catch (err) {}
    try { out.history = await rawGetAll(STORE_HIST); } catch (err) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.lastIndexOf('dts_', 0) === 0) out.ls[k] = localStorage.getItem(k);
      }
    } catch (err) {}
    return out;
  }

  async function restoreState(snap) {
    snap = snap || {};
    try { await rawPutAll(STORE_FAVS, snap.favs); } catch (err) {}
    try { await rawPutAll(STORE_HIST, snap.history); } catch (err) {}
    Object.keys(snap.ls || {}).forEach(function (k) {
      try { localStorage.setItem(k, snap.ls[k]); } catch (err) {}
    });
    // re-run the tool's own loader so its in-memory copies pick up the
    // freshly written database (it renders from memory, not from the db)
    try { Favorites.init(); } catch (err) {}
    try {
      var t = localStorage.getItem('dts_theme');
      if (t) document.documentElement.setAttribute('data-theme', t);
    } catch (err) {}
  }

  async function readLedger() {
    if (MODE === 'fs') {
      if (!fsHandle) throw new Error('no ledger connected');
      var f = await fsHandle.getFile();
      var txt = await f.text();
      return txt.trim() ? JSON.parse(txt) : {};
    }
    var resp = await fetch(API_BASE);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  async function writeLedger(snap) {
    if (MODE === 'fs') {
      if (!fsHandle) return;
      var w = await fsHandle.createWritable();
      await w.write(JSON.stringify(snap));
      await w.close();
      return;
    }
    await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap),
    });
  }

  async function pullLedger() {
    try {
      var snap = await readLedger();
      await restoreState(snap);
      lastSnapStr = JSON.stringify(await dumpState());
      send('dts_ledger_status', { connected: true, mode: MODE });
    } catch (err) {
      send('dts_ledger_status', {
        connected: false,
        mode: MODE,
        error: String((err && err.message) || err),
      });
      throw err;
    }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async function () {
      try {
        var snap = await dumpState();
        var s = JSON.stringify(snap);
        if (s !== lastSnapStr) {
          await writeLedger(snap);
          lastSnapStr = s;
        }
      } catch (err) {
        var msg = String((err && err.message) || err);
        send('dts_ledger_status', { connected: false, mode: MODE, error: msg });
        try { toast('⚠ 改动未能写入共享账本: ' + msg.slice(0, 60)); } catch (e) {}
      }
    }, 600);
  }

  // watch for changes: wrap the two central writers plus a slow safety net
  var origLsSet = Storage.lsSet;
  Storage.lsSet = function (mutator) { origLsSet.call(Storage, mutator); schedulePush(); };
  setInterval(function () {
    dumpState().then(function (snap) {
      var s = JSON.stringify(snap);
      if (s !== lastSnapStr) schedulePush();
    }).catch(function () {});
  }, 4000);

  // ---------- FS Access wiring (local file mode only) ----------
  function showLedgerBanner(text, buttonText, onClick) {
    var bar = document.createElement('div');
    bar.id = 'dts-ledger-banner';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10003;display:flex;' +
      'gap:10px;align-items:center;justify-content:center;padding:8px 12px;' +
      'background:var(--surface-2, #1d1d2d);border-bottom:1px solid var(--border, #3a1a2e);color:var(--text-2, #b8b8c8);font-size:12px';
    var span = document.createElement('span');
    span.textContent = text;
    bar.append(span);
    if (buttonText) {
      var btn = document.createElement('button');
      btn.textContent = buttonText;
      btn.style.cssText = 'padding:4px 14px;cursor:pointer;border-radius:6px;' +
        'border:1px solid var(--accent, #881144);background:var(--accent, #881144);color:var(--bg, #fff);font-size:12px';
      btn.addEventListener('click', onClick);
      bar.append(btn);
    }
    document.body.append(bar);
  }

  function openHandleStore() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('dts_fs_ledger', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('handles'); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  async function connectLedger(interactive) {
    try {
      var db = await openHandleStore();
      fsHandle = await new Promise(function (res) {
        var r = db.transaction('handles').objectStore('handles').get('ledger');
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      });
      if (fsHandle) {
        var perm = await fsHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && interactive) {
          perm = await fsHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') fsHandle = null;
      }
      if (!fsHandle && interactive) {
        var picks = await window.showOpenFilePicker({
          types: [{ description: '共享账本 JSON', accept: { 'application/json': ['.json'] } }],
          startIn: 'documents',
        });
        fsHandle = picks[0] || null;
        if (fsHandle) {
          var db2 = await openHandleStore();
          db2.transaction('handles', 'readwrite').objectStore('handles').put(fsHandle, 'ledger');
          // empty or invalid file: adopt it as a fresh ledger
          try {
            var f0 = await fsHandle.getFile();
            JSON.parse((await f0.text()) || '{}');
          } catch (initErr) {
            var w0 = await fsHandle.createWritable();
            await w0.write('{}');
            await w0.close();
            toast('所选文件已初始化为共享账本');
          }
        }
      }
      if (!fsHandle) {
        showLedgerBanner('未连接共享账本，数据暂存本机浏览器', '🔗 连接账本文件', function () {
          connectLedger(true).then(function () {
            var b = document.getElementById('dts-ledger-banner');
            if (b) b.remove();
          }).catch(function (err) { toast('连接失败: ' + err.message); });
        });
        return;
      }
      await pullLedger();
      // first connection: if the ledger is still empty but this browser has
      // history, seed the ledger with it so old content becomes visible to
      // every other entry point immediately
      var localSnap = await dumpState();
      var hasLocal = (localSnap.favs && localSnap.favs.length) || (localSnap.history && localSnap.history.length);
      var ledgerNow = await readLedger();
      var ledgerEmpty = !(ledgerNow.favs && ledgerNow.favs.length) && !(ledgerNow.history && ledgerNow.history.length);
      if (hasLocal && ledgerEmpty) {
        await writeLedger(localSnap);
        try { toast('已将本地 ' + (localSnap.favs || []).length + ' 条收藏搬入共享账本'); } catch (err) {}
      }
    } catch (err) {
      // stale handle (file moved/renamed/deleted) or read failure:
      // drop it and offer reconnection instead of dying silently
      fsHandle = null;
      var msg = String((err && err.message) || err);
      var hint;
      if (err && err.name === 'NotFoundError') hint = '账本文件已被删除或移动';
      else if (err && err.name === 'SyntaxError') hint = '账本文件内容不是有效 JSON';
      else if (msg.indexOf('Permission') !== -1) hint = '浏览器拒绝了文件访问权限，请点重新连接';
      else hint = msg.slice(0, 80);
      showLedgerBanner('账本同步失败：' + hint, '🔗 重新连接', function () {
        connectLedger(true).then(function () {
          var b = document.getElementById('dts-ledger-banner');
          if (b) b.remove();
        }).catch(function (e2) { toast('连接失败: ' + e2.message); });
      });
      try { toast('账本同步不可用: ' + msg); } catch (err2) {}
    }
  }

  if (MODE === 'fs') {
    connectLedger(false);
  } else {
    // let the page finish its own async boot sequence before we overlay it
    setTimeout(function () { pullLedger().catch(function () {}); }, 800);
  }
})();
