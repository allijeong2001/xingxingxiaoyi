/* =====================================================
 * 全局音频播放器（一起听）
 * - 音频文件存在 IndexedDB，播放进度/音量存在 localStorage
 * - 切换页面时自动从上次的位置继续播放（纯后台，无浮窗）
 * - 播放界面只在 music.html 里
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
  var wantPlay = !!state.wantPlay; // 用户是否希望正在播放（跨页面恢复用）
  var gestureArmed = false; // 是否已挂上"首次交互后恢复播放"的监听

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
        wantPlay: wantPlay,
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
    wantPlay = true;
    var p = audio.play();
    if (p && p.catch) p.catch(function () {
      /* 浏览器自动播放策略拦截：等用户在本页的第一次交互（点击/触摸/按键）立即恢复 */
      saveState();
      armResumeOnGesture();
      notify();
    });
  }
  function pause() { wantPlay = false; audio.pause(); }
  function toggle() { if (!audio.src) return; audio.paused ? play() : pause(); }

  /* 首次交互后恢复播放（绕过自动播放限制的标准做法） */
  function armResumeOnGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    var opts = { capture: true };
    function resume() {
      gestureArmed = false;
      removeEventListener('click', resume, opts);
      removeEventListener('touchend', resume, opts);
      removeEventListener('keydown', resume, opts);
      if (wantPlay) play();
    }
    addEventListener('click', resume, opts);
    addEventListener('touchend', resume, opts);
    addEventListener('keydown', resume, opts);
  }
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

  /* ---------- 播放条只在 music.html 内展示 ----------
   * 其他页面不显示任何浮窗，仅在后台静默续播
   * （每次切页会从 IndexedDB 恢复音频并接着上次进度播放）
   */
  function buildMini() { /* 不再在其他页面创建迷你播放条 */ }
  function renderMini() { /* 无浮窗可渲染 */ }

  function init() {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------- 初始化：恢复上次的曲目 ---------- */
  if (trackName) {
    idbGet('current_audio').then(function (blob) {
      if (!blob) { trackName = ''; wantPlay = false; saveState(); renderMini(); return; }
      objUrl = URL.createObjectURL(blob);
      audio.src = objUrl;
      if (pendingSeek > 0) {
        try { audio.currentTime = pendingSeek; } catch (e) {}
      }
      if (state.wantPlay || state.playing) play();
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
