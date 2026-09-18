/* =====================================================
 * 全局音频播放器（一起听）
 * - 音频文件存在 IndexedDB，播放进度/音量存在 localStorage
 * - 切换页面时自动从上次的位置继续播放
 * - music.html 以外的页面会显示迷你播放条
 * ===================================================== */
window.XYPlayer = (function () {
  var LS_KEY = 'xy_player_state';
  var state = loadState();
  var audio = new Audio();
  audio.preload = 'auto';
  audio.volume = typeof state.volume === 'number' ? state.volume : 0.9;

  var objUrl = null;
  var trackName = state.name || '';
  var isMusicPage = /music\.html/i.test(location.href.split('/').pop() || '');
  var listeners = [];
  var miniEl = null;
  var pendingSeek = typeof state.time === 'number' ? state.time : 0;

  /* ---------- 状态存取 ---------- */
  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        name: trackName,
        playing: !audio.paused && !audio.ended,
        time: audio.currentTime || 0,
        volume: audio.volume
      }));
    } catch (e) {}
  }

  /* ---------- IndexedDB（存音频文件） ---------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('xy_player_db', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbOp(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', mode);
        var req = fn(tx.objectStore('files'));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(key) { return idbOp('readonly', function (s) { return s.get(key); }); }
  function idbSet(key, val) { return idbOp('readwrite', function (s) { return s.put(val, key); }); }

  /* ---------- 事件 ---------- */
  audio.addEventListener('timeupdate', function () { saveState(); notify(); });
  audio.addEventListener('play', function () { saveState(); notify(); });
  audio.addEventListener('pause', function () { saveState(); notify(); });
  audio.addEventListener('ended', function () { saveState(); notify(); });
  audio.addEventListener('loadedmetadata', function () {
    if (pendingSeek >= 0) {
      try { audio.currentTime = pendingSeek; } catch (e) {}
      pendingSeek = -1;
    }
  });
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveState(); });

  function notify() {
    listeners.forEach(function (f) { try { f(); } catch (e) {} });
  }

  /* ---------- 播放控制 ---------- */
  function setTrack(name, blob) {
    trackName = name;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    objUrl = URL.createObjectURL(blob);
    audio.src = objUrl;
    pendingSeek = -1;
    idbSet('current_audio', blob).catch(function () {});
    saveState();
    play();
    notify();
  }
  function play() {
    var p = audio.play();
    if (p && p.catch) p.catch(function () { saveState(); notify(); });
  }
  function pause() { audio.pause(); }
  function toggle() { if (!audio.src) return; audio.paused ? play() : pause(); }
  function seek(t) {
    if (!audio.src) return;
    audio.currentTime = Math.max(0, Math.min(t, audio.duration || 0));
    saveState();
    notify();
  }
  function setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
    saveState();
    notify();
  }
  function hasTrack() { return !!trackName; }
  function getName() { return trackName; }

  /* ---------- 迷你播放条（music 页除外） ---------- */
  function buildMini() {
    if (isMusicPage || miniEl) return;
    var el = document.createElement('div');
    el.className = 'mini-player';
    el.style.display = 'none';
    el.innerHTML =
      '<span class="mp-cover">🍋</span>' +
      '<div class="mp-info">' +
        '<div class="mp-name"></div>' +
        '<div class="mp-state">和萧逸一起听中 ♪</div>' +
      '</div>' +
      '<button class="mp-btn" type="button">▶</button>' +
      '<div class="mp-prog"><i></i></div>';
    document.body.appendChild(el);
    el.querySelector('.mp-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    el.querySelector('.mp-info').addEventListener('click', function () {
      location.href = 'music.html';
    });
    miniEl = el;
  }

  function renderMini() {
    if (!miniEl) return;
    if (!trackName) { miniEl.style.display = 'none'; return; }
    miniEl.style.display = 'flex';
    miniEl.querySelector('.mp-name').textContent = trackName;
    miniEl.querySelector('.mp-btn').textContent = audio.paused ? '▶' : '⏸';
    miniEl.classList.toggle('playing', !audio.paused);
    var dur = audio.duration || 0;
    var pct = dur ? (audio.currentTime / dur) * 100 : 0;
    miniEl.querySelector('.mp-prog i').style.width = pct + '%';
  }
  listeners.push(renderMini);

  function init() {
    buildMini();
    renderMini();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------- 初始化：恢复上次的曲目 ---------- */
  if (trackName) {
    idbGet('current_audio').then(function (blob) {
      if (!blob) { trackName = ''; saveState(); renderMini(); return; }
      objUrl = URL.createObjectURL(blob);
      audio.src = objUrl;
      if (pendingSeek > 0) {
        try { audio.currentTime = pendingSeek; } catch (e) {}
      }
      if (state.playing) play();
      notify();
    }).catch(function () {});
  }

  return {
    audio: audio,
    setTrack: setTrack,
    play: play,
    pause: pause,
    toggle: toggle,
    seek: seek,
    setVolume: setVolume,
    hasTrack: hasTrack,
    getName: getName,
    onChange: function (f) { listeners.push(f); }
  };
})();
