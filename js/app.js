/* PinRefBoard — app */
(function () {
  'use strict';

  var BOARD_LABEL = { character: 'Character', reference: 'Reference' };
  var BATCH = 120;
  var HELPER_PORTS = [8924, 8925, 8926];
  var ACTIONS_URL = 'https://github.com/Mmitekk/PinRefBoard/actions/workflows/sync.yml';
  var SYNC_CACHE = 'prb-sync';

  // найти локальный хелпер: пингуем порты, выбираем с наибольшей версией (старые зомби-процессы игнорируем)
  function findHelper() {
    var probes = HELPER_PORTS.map(function (port) {
      return fetchWithTimeout('http://127.0.0.1:' + port + '/ping', 900)
        .then(function (r) { return r.json(); })
        .then(function (j) { return j && j.ok ? { port: port, v: j.v || 1 } : null; })
        .catch(function () { return null; });
    });
    return Promise.all(probes).then(function (list) {
      var found = list.filter(Boolean);
      found.sort(function (a, b) { return b.v - a.v; });
      return found.length ? 'http://127.0.0.1:' + found[0].port : null;
    });
  }

  function tagPins(pins, board) {
    for (var i = 0; i < pins.length; i++) if (!pins[i].board) pins[i].board = board;
    return pins;
  }

  function loadSyncCache() {
    try {
      var raw = localStorage.getItem(SYNC_CACHE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSyncCache(cache) {
    try { localStorage.setItem(SYNC_CACHE, JSON.stringify(cache)); } catch (e) { /* quota — ignore */ }
  }

  // merge cached pins (from previous local syncs) over the baked-in data
  var DATA = {
    character: tagPins(window.__PINS_CHARACTER || [], 'character'),
    reference: tagPins(window.__PINS_REFERENCE || [], 'reference'),
  };
  (function mergeCache() {
    var cache = loadSyncCache();
    if (!cache || !cache.pins) return;
    ['character', 'reference'].forEach(function (board) {
      var fresh = cache.pins[board] || [];
      var byId = {};
      DATA[board].forEach(function (p) { byId[p.id] = p; });
      fresh.forEach(function (p) {
        p.board = board;
        if (!byId[p.id]) DATA[board].push(p);
      });
    });
  })();

  var state = {
    board: localStorage.getItem('prb-board') || 'all',
    query: '',
    color: localStorage.getItem('prb-color') === '1',
    filtered: [],
    rendered: 0,
  };

  if (!DATA[state.board] && state.board !== 'all') state.board = 'all';

  // ---------- dom ----------
  var grid = document.getElementById('grid');
  var sentinel = document.getElementById('sentinel');
  var emptyBox = document.getElementById('empty');
  var loader = document.getElementById('loader');
  var searchInput = document.getElementById('search');
  var searchClear = document.getElementById('search-clear');
  var colorToggle = document.getElementById('color-toggle');
  var tabs = document.getElementById('tabs');
  var metaStats = document.getElementById('meta-stats');

  var modal = document.getElementById('modal');
  var modalImg = document.getElementById('modal-img');
  var modalFrame = document.getElementById('modal-frame');
  var modalSpinner = document.getElementById('modal-spinner');
  var modalCounter = document.getElementById('modal-counter');
  var modalTag = document.getElementById('modal-tag');
  var modalTitle = document.getElementById('modal-title');
  var modalDesc = document.getElementById('modal-desc');
  var modalLink = document.getElementById('modal-link');
  var lastFocused = null;
  var modalIndex = -1;

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pinText(p) {
    return ((p.title || '') + ' ' + (p.description || '') + ' ' + BOARD_LABEL[p.board]).toLowerCase();
  }

  function updateCounts() {
    document.getElementById('cnt-all').textContent = DATA.character.length + DATA.reference.length;
    document.getElementById('cnt-character').textContent = DATA.character.length;
    document.getElementById('cnt-reference').textContent = DATA.reference.length;
  }

  function updateMeta() {
    var total = DATA.character.length + DATA.reference.length;
    var now = new Date();
    var updated = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear();
    if (state.filtered.length === total) {
      metaStats.textContent = total + ' пинов · Character ' + DATA.character.length + ' · Reference ' + DATA.reference.length + ' · обновлено ' + updated;
    } else {
      metaStats.textContent = 'найдено: ' + state.filtered.length + ' из ' + total;
    }
  }

  // ---------- filtering ----------
  function applyFilter(keepQuery) {
    var q = state.query.trim().toLowerCase();
    var source;
    if (state.board === 'all') {
      source = DATA.character.concat(DATA.reference);
    } else {
      source = DATA[state.board];
    }
    state.filtered = q ? source.filter(function (p) { return pinText(p).indexOf(q) !== -1; }) : source;
    state.rendered = 0;
    grid.innerHTML = '';
    emptyBox.hidden = state.filtered.length > 0;
    renderBatch();
    updateMeta();
    if (!keepQuery) syncSearchUi();
  }

  function syncSearchUi() {
    searchClear.hidden = !state.query;
    if (searchInput.value !== state.query) searchInput.value = state.query;
  }

  // ---------- rendering ----------
  function makeCard(pin, i) {
    var fig = el('figure', 'card');
    fig.tabIndex = 0;
    fig.setAttribute('role', 'button');

    var t = (pin.title || '').trim();
    var d = (pin.description || '').trim();
    var text = t || d || 'Изображение';
    fig.setAttribute('aria-label', text + ' — открыть');

    var img = el('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = text;
    var dims = pin.img.medium || pin.img.small || pin.img.orig || { w: 3, h: 4 };
    img.style.aspectRatio = dims.w + ' / ' + dims.h;
    img.style.backgroundColor = pin.color || '#1f1f23';
    img.src = (pin.img.medium || pin.img.small || pin.img.large || pin.img.orig).u;
    img.addEventListener('error', function () {
      if (img.dataset.fb === undefined && pin.img.small) { img.dataset.fb = '1'; img.src = pin.img.small.u; }
      else { fig.style.display = 'none'; }
    });

    var idx = el('span', 'idx', '#' + String(i + 1).padStart(3, '0'));
    var cap = el('figcaption');
    cap.appendChild(el('span', 'tag', BOARD_LABEL[pin.board]));
    cap.appendChild(el('p', 'cap', (t ? t : d) || ''));
    fig.appendChild(img);
    fig.appendChild(idx);
    fig.appendChild(cap);

    fig.addEventListener('click', function () { openModal(i, fig); });
    fig.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(i, fig); }
    });
    return fig;
  }

  function renderBatch() {
    var frag = document.createDocumentFragment();
    var end = Math.min(state.rendered + BATCH, state.filtered.length);
    for (var i = state.rendered; i < end; i++) frag.appendChild(makeCard(state.filtered[i], i));
    state.rendered = end;
    grid.appendChild(frag);
    loader.hidden = state.rendered >= state.filtered.length;
  }

  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting && state.rendered < state.filtered.length) renderBatch();
  }, { rootMargin: '900px' });
  io.observe(sentinel);

  // ---------- modal ----------
  function setModalImage(pin) {
    modalFrame.classList.remove('zoomed');
    modalSpinner.hidden = false;
    modalImg.style.visibility = 'hidden';
    var chain = [pin.img.orig, pin.img.large, pin.img.medium, pin.img.small].filter(Boolean);
    var k = 0;
    var onOk = function () {
      modalImg.removeEventListener('load', onOk);
      modalImg.removeEventListener('error', onErr);
      modalSpinner.hidden = true;
      modalImg.style.visibility = 'visible';
    };
    var onErr = function () {
      modalImg.removeEventListener('load', onOk);
      modalImg.removeEventListener('error', onErr);
      k++;
      if (k < chain.length) { modalImg.addEventListener('load', onOk); modalImg.addEventListener('error', onErr); modalImg.src = chain[k].u; }
      else { modalSpinner.hidden = true; modalImg.style.visibility = 'visible'; }
    };
    modalImg.addEventListener('load', onOk);
    modalImg.addEventListener('error', onErr);
    modalImg.src = chain[0].u;
    // pre-load neighbours
    var n = state.filtered.length;
    if (n > 1) {
      [state.filtered[(modalIndex + 1) % n], state.filtered[(modalIndex - 1 + n) % n]].forEach(function (p2) {
        if (p2.img.orig) { var pre = new Image(); pre.src = p2.img.orig.u; }
      });
    }
  }

  function openModal(i, sourceEl) {
    if (i < 0 || i >= state.filtered.length) return;
    lastFocused = sourceEl || document.activeElement;
    modalIndex = i;
    var pin = state.filtered[i];
    modalImg.alt = (pin.title || pin.description || '').trim();
    modalCounter.textContent = (i + 1) + ' / ' + state.filtered.length;
    modalTag.textContent = BOARD_LABEL[pin.board];
    var t = (pin.title || '').trim();
    var d = (pin.description || '').trim();
    modalTitle.textContent = t;
    modalTitle.hidden = !t;
    modalDesc.textContent = d;
    modalDesc.hidden = !d;
    modalLink.href = pin.link;
    setModalImage(pin);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    document.getElementById('modal-close').focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    modalImg.src = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function navModal(dir) {
    var n = state.filtered.length;
    if (!n) return;
    openModal((modalIndex + dir + n) % n);
  }

  modalFrame.addEventListener('click', function () { modalFrame.classList.toggle('zoomed'); });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('modal-prev').addEventListener('click', function () { navModal(-1); });
  document.getElementById('modal-next').addEventListener('click', function () { navModal(1); });

  document.addEventListener('keydown', function (e) {
    if (!modal.hidden) {
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowLeft') navModal(-1);
      else if (e.key === 'ArrowRight') navModal(1);
      return;
    }
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ---------- controls ----------
  tabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    state.board = btn.dataset.board;
    localStorage.setItem('prb-board', state.board);
    tabs.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
    applyFilter();
  });

  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = searchInput.value;
      applyFilter(true);
    }, 160);
  });
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchInput.blur(); });
  searchClear.addEventListener('click', function () { searchInput.value = ''; state.query = ''; applyFilter(); searchInput.focus(); });

  document.getElementById('empty-reset').addEventListener('click', function () {
    state.board = 'all';
    localStorage.setItem('prb-board', 'all');
    tabs.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.board === 'all'); });
    state.query = '';
    applyFilter();
  });

  function syncColorUi() {
    document.body.classList.toggle('color', state.color);
    colorToggle.classList.toggle('on', state.color);
    colorToggle.title = state.color ? 'Монохром' : 'Показать цвет';
    colorToggle.setAttribute('aria-label', colorToggle.title);
  }
  colorToggle.addEventListener('click', function () {
    state.color = !state.color;
    localStorage.setItem('prb-color', state.color ? '1' : '0');
    syncColorUi();
  });

  // ---------- sync ----------
  var toast = document.getElementById('toast');
  var toastTimer = null;

  function showToast(html, sticky) {
    toast.innerHTML = html;
    toast.hidden = false;
    // rAF ненадёжен во встроенных браузерах — используем setTimeout
    setTimeout(function () { toast.classList.add('show'); }, 16);
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, 10000);
  }

  function hideToast() {
    toast.classList.remove('show');
    toastTimer = setTimeout(function () { toast.hidden = true; }, 300);
  }

  function fetchWithTimeout(url, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, { signal: ctl.signal }).finally(function () { clearTimeout(t); });
  }

  var syncBtn = document.getElementById('sync-btn');

  function mergePins(pinsByBoard) {
    var freshCount = 0;
    var cache = loadSyncCache() || { ts: 0, pins: { character: [], reference: [] } };
    ['character', 'reference'].forEach(function (board) {
      var fresh = (pinsByBoard && pinsByBoard[board]) || [];
      var byId = {};
      DATA[board].forEach(function (p) { byId[p.id] = p; });
      fresh.forEach(function (p) {
        if (!byId[p.id]) {
          p.board = board;
          DATA[board].push(p);
          byId[p.id] = p;
          freshCount++;
        }
      });
      // refresh cache: replace entries for this board with the fresh snapshot
      cache.pins[board] = fresh.length ? fresh : DATA[board];
    });
    cache.ts = Date.now();
    saveSyncCache(cache);
    return freshCount;
  }

  function doSync() {
    if (syncBtn.classList.contains('busy')) return;
    syncBtn.classList.add('busy');
    showToast('Синхронизация: ищу локальный хелпер…', true);

    findHelper()
      .then(function (base) {
        if (!base) throw new Error('no-helper');
        showToast('Синхронизация: собираю пины с Pinterest (1–3 минуты)…', true);
        return fetchWithTimeout(base + '/sync', 300000).then(function (r) { return r.json(); });
      })
      .then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'sync failed');
        var added = mergePins(res.pins);
        updateCounts();
        applyFilter(true);
        var msg = added > 0
          ? 'Готово: +' + added + ' новых пинов · Character ' + res.totals.character + ', Reference ' + res.totals.reference
          : 'Готово: новых пинов нет — на Pinterest ничего не появилось с последнего сбора · Character ' + res.totals.character + ', Reference ' + res.totals.reference;
        if (res.committed) msg += ' · закоммичено локально — запушьте для публикации';
        showToast(msg, false);
      })
      .catch(function (e) {
        if (e.message === 'no-helper' || e.name === 'AbortError') {
          showToast('Локальный хелпер не отвечает. Запустите PinRefSync (ярлык на рабочем столе) или <a href="' + ACTIONS_URL + '" target="_blank" rel="noopener">запустите синк на GitHub Actions ↗</a>', false);
        } else {
          showToast('Синхронизация не удалась: ' + String(e.message || e) + ' · можно запустить <a href="' + ACTIONS_URL + '" target="_blank" rel="noopener">через GitHub Actions ↗</a>', false);
        }
      })
      .finally(function () {
        syncBtn.classList.remove('busy');
      });
  }

  syncBtn.addEventListener('click', doSync);

  // ---------- init ----------
  updateCounts();
  syncColorUi();
  tabs.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.board === state.board); });
  applyFilter();
})();
