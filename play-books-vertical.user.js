// ==UserScript==
// @name         Google Play Books 上下スクロール
// @namespace    local.playbooks.vertical
// @homepageURL  https://github.com/takeshi46/PlayBook
// @downloadURL  https://raw.githubusercontent.com/takeshi46/PlayBook/main/play-books-vertical.user.js
// @updateURL    https://raw.githubusercontent.com/takeshi46/PlayBook/main/play-books-vertical.user.js
// @version      1.15.2
// @description  本一覧に読書進行度（％）を表示。端末標準TTSでの読み上げ（速度・声・追従）。横書き・上下スクロール（自動読み込み）とサムネ付き挿絵一覧ジャンプ。リーダーの章データから画像位置を取得。通常表示・ルビ対応。
// @match        https://books.googleusercontent.com/books/reader/frame*
// @match        https://play.google.com/books/reader*
// @match        https://play.google.com/books
// @match        https://play.google.com/books?*
// @match        https://play.google.com/books/
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  // 本一覧: 各カードの表紙に読書進行度（％）を重ねる。ページ自身の通信を読むだけで、保存・変更はしない。
  if (location.hostname === 'play.google.com' && /^\/books\/?$/.test(location.pathname)) { libraryProgress(); return; }
  function libraryProgress() {
    const progress = new Map();   // 本のID → 進行度(%)
    // 戻った直後に消えないよう、「本のID → [％, 総ページ数]」だけを端末（localStorage）に保存する。書名などは保存しない。
    const KEY = 'pbv-lib-progress', saved = {};
    try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 保存データが壊れていたら無視 */ }
    for (const [id, v] of Object.entries(saved)) if (Array.isArray(v)) progress.set(id, v[0]);
    let frame = 0;
    // 最後に読んだ位置（GBS.PT43.… の 43）。リーダー下部の「43 / 253」のページ数と一致する。
    const findPos = n => {
      if (typeof n === 'string') { const m = n.match(/^GBS\.P[TA](\d+)/); return m ? Number(m[1]) : 0; }
      if (Array.isArray(n)) for (const c of n) { const v = findPos(c); if (v) return v; }
      return 0;
    };
    // ponytail: 応答は位置で意味が決まる配列。本1冊 = [本ID, 詳細(5番目が総ページ数), ユーザー情報(最後の位置を含む), …]。
    // 仕様変更で並びが変わると表示されなくなる（壊れても本一覧の動作には影響しない）。
    const collect = text => {
      let data;
      try { data = JSON.parse(text); } catch { return; }
      const visit = node => {
        if (!Array.isArray(node)) return;
        const [id, meta] = node;
        if (typeof id === 'string' && /^[\w-]{12}$/.test(id) && Array.isArray(meta) && typeof meta[5] === 'number' && meta[5] > 0) {
          const pos = findPos(node.slice(2));
          if (pos) {
            const pct = Math.min(100, Math.round(pos / meta[5] * 100));
            progress.set(id, pct); saved[id] = [pct, meta[5]];
          }
          return;
        }
        node.forEach(visit);
      };
      visit(data);
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 保存できなくても表示はできる */ }
      schedule();
    };
    const isLibrary = url => /LibraryService\/SyncUserLibrary/.test(url || '');
    const nativeFetch = window.fetch;
    window.fetch = function(...args) {
      const result = nativeFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (isLibrary(url)) result.then(r => r.clone().text()).then(collect).catch(() => {});
      } catch { /* 読み取りに失敗しても通信は止めない */ }
      return result;
    };
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (isLibrary(String(url))) {
        this.addEventListener('load', () => {
          try { collect(this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText); } catch { /* 無視 */ }
        });
      }
      return nativeOpen.call(this, method, url, ...rest);
    };
    const style = document.createElement('style');
    style.textContent = `
      .pbv-pct { position:absolute;left:0;right:0;bottom:0;pointer-events:none; }
      .pbv-pct u { display:block;height:4px;background:rgba(0,0,0,.4); }
      .pbv-pct i { display:block;height:100%;background:#1a73e8; }
      .pbv-pct b { position:absolute;right:3px;bottom:7px;padding:2px 6px;border-radius:9px;
        background:rgba(0,0,0,.7);color:#fff;font:bold 11px/1.2 sans-serif; }`;
    // カードが描画された同じ1コマで反映する（遅らせると、％が後から出てくるのが見える）。
    function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); }); }
    function apply() {
      if (!style.isConnected) (document.head || document.documentElement)?.append(style);
      for (const card of document.querySelectorAll('gpb-volume-card')) {
        const cover = card.querySelector('.cover-image-container');
        const href = card.querySelector('a[href*="reader?id="]')?.href;
        if (!cover || !href) continue;
        const pct = progress.get(new URL(href).searchParams.get('id'));
        let el = cover.querySelector(':scope > .pbv-pct');
        if (!pct) { el?.remove(); continue; }
        if (!el) {
          el = document.createElement('div'); el.className = 'pbv-pct'; el.innerHTML = '<u><i></i></u><b></b>';
          cover.append(el);
        }
        const label = `${pct}%`, bar = el.querySelector('i'), text = el.querySelector('b');
        // 同じ値の再代入でもDOMが変わり、監視が連鎖するので、違うときだけ書く。
        if (text.textContent !== label) text.textContent = label;
        if (bar.style.width !== label) bar.style.width = label;
      }
    }
    new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
    schedule();
  }
  // 親ページだけが読書URLを操作する。iframeから渡されたURLは使用しない。
  if (location.hostname === 'play.google.com') {
    // 本一覧の％を最新にする。URLの pg=GBS.PT43… が今の位置。総ページ数は本一覧が保存した値を使う。
    const saveProgress = () => {
      try {
        const q = new URL(location.href).searchParams, id = q.get('id'), m = (q.get('pg') || '').match(/^GBS\.P[TA](\d+)/);
        const all = JSON.parse(localStorage.getItem('pbv-lib-progress') || '{}');
        if (!id || !m || !Array.isArray(all[id]) || !(all[id][1] > 0)) return;
        all[id][0] = Math.min(100, Math.round(Number(m[1]) / all[id][1] * 100));
        localStorage.setItem('pbv-lib-progress', JSON.stringify(all));
      } catch { /* 失敗しても読書には影響しない */ }
    };
    window.addEventListener('pagehide', saveProgress);
    setInterval(saveProgress, 5000);
    window.addEventListener('message', event => {
      const frame = document.querySelector('iframe.-gb-display');
      if (event.origin !== 'https://books.googleusercontent.com' || event.source !== frame?.contentWindow) return;
      const url = new URL(location.href), id = url.searchParams.get('id');
      if (!id) return;
      const key = `pbv-return:${id}`, modeKey = `pbv-mode:${id}`, targetKey = `pbv-target:${id}`;
      let bookmark, mode, savedIndex, landing;
      try { bookmark = JSON.parse(sessionStorage.getItem(key) || 'null'); mode = sessionStorage.getItem(modeKey) === 'true'; } catch {}
      try { landing = sessionStorage.getItem(targetKey); } catch {}
      try { savedIndex = JSON.parse(localStorage.getItem(`pbv-index:${id}`) || 'null'); } catch {}
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'pbv-context') {
        event.source.postMessage({ type: 'pbv-context', id, pg: url.searchParams.get('pg'), mode, bookmark, index: savedIndex, landing }, event.origin);
      } else if (data.type === 'pbv-landed') {
        try { sessionStorage.removeItem(targetKey); } catch {}
      } else if (data.type === 'pbv-index') {
        const merged = { images: [], ranges: [] };
        mergeIndex(merged, data.index); mergeIndex(merged, savedIndex);
        try { localStorage.setItem(`pbv-index:${id}`, JSON.stringify(merged)); } catch {}
      } else if (data.type === 'pbv-mark') {
        try { sessionStorage.setItem(key, JSON.stringify({ pg: url.searchParams.get('pg'), mode: data.mode === true })); } catch {}
        event.source.postMessage({ type: 'pbv-marked', pg: url.searchParams.get('pg') }, event.origin);
      } else if (data.type === 'pbv-goto' || data.type === 'pbv-return') {
        const pg = data.type === 'pbv-return' ? bookmark?.pg : data.pg;
        if (typeof pg !== 'string' || !/^GBS\.[A-Za-z0-9_.+-]{1,180}$/.test(pg)) return;
        try {
          if (data.type === 'pbv-goto') sessionStorage.setItem(targetKey, pg);
          else sessionStorage.removeItem(targetKey);
        } catch {}
        try { sessionStorage.setItem(modeKey, String(data.type === 'pbv-return' ? bookmark.mode : data.mode === true)); } catch {}
        url.searchParams.set('pg', pg);
        location.assign(url.href);
      }
    });
    return;
  }
  const streamed = { images: [], ranges: [] };
  let manifest, refresh = () => {};
  // 通常のリーダーが受信した章HTMLだけを読む。通信内容やアプリのコールバックは変更しない。
  const observed = new WeakSet(), add = MessagePort.prototype.addEventListener;
  function receive(event) {
    const data = event.data;
    const info = data?.manifest || data;
    if (info?.metadata?.volume_id && Array.isArray(info.segment)) manifest = info;
    if (typeof data?.content !== 'string' || data.content.length > 2000000
      || !manifest?.segment.some(s => s.label === data.current_position)) return;
    try {
      mergeIndex(streamed, contentIndex(data.content));
      refresh();
    } catch {}
  }
  function observe(port) {
    if (!observed.has(port)) {
      observed.add(port);
      add.call(port, 'message', receive);
    }
  }
  MessagePort.prototype.addEventListener = function(type, ...args) {
    if (type === 'message') observe(this);
    return add.call(this, type, ...args);
  };
  const onmessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', {
    ...onmessage,
    set(value) { if (value) observe(this); return onmessage.set.call(this, value); },
  });
  window.addEventListener('message', event => {
    if (event.origin === 'https://play.google.com' && event.source === window.parent) event.ports?.forEach(observe);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();

  function contentIndex(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const anchors = [...doc.querySelectorAll('[id]')].filter(a => order(a.id) !== null);
    const result = { images: [], ranges: [] };
    for (const image of doc.querySelectorAll('img, svg image')) {
      // ponytail: 元画像の縦横200px以上を対象にする。挿絵と広告画像の区別はしない。
      if (!(Number(image.getAttribute('width')) >= 200 && Number(image.getAttribute('height')) >= 200)) continue;
      const before = anchors.filter(a => a.compareDocumentPosition(image) & 4).at(-1);
      if (!before) continue;
      // Googleの文字オフセットはDOMの文字数と一致しないため、挿絵直前の正式アンカーを使う。
      const src = thumbSrc(image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href'));
      result.images.push({ pg: before.id, order: order(before.id), src });
    }
    if (anchors.length) result.ranges.push([order(anchors[0].id), order(anchors.at(-1).id)]);
    return result;
  }
  function order(pg) {
    const match = /^GBS\.PT(\d+)(?:[._]|$)/.exec(pg || '');
    const value = match ? Number(match[1]) : /^GBS\.PP1(?:[._]|$)/.test(pg || '') ? 0 : null;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  // サムネ用の画像URL。Google Booksのhttpsのみ許可し、保存値も同じ検証を通す。
  function thumbSrc(value) {
    if (typeof value !== 'string' || !value) return undefined;
    try {
      const url = new URL(value, 'https://play.google.com/books/');
      return url.protocol === 'https:' && /^(play|books)\.google\.com$/.test(url.hostname) && url.href.length <= 1000
        ? url.href : undefined;
    } catch { return undefined; }
  }
  function mergeIndex(index, saved) {
    if (!saved) return;
    for (const item of Array.isArray(saved.images) ? saved.images : []) {
      const pg = typeof item?.pg === 'string' ? item.pg.replace(/_\d+$/, '') : null;
      if (typeof item?.pg === 'string' && /^GBS\.[A-Za-z0-9_.+-]{1,180}$/.test(item.pg)
        && Number.isSafeInteger(item.order) && item.order >= 0 && order(item.pg) === item.order) {
        // 先に統合した（新しい）URLを優先し、無い場合だけ補う。
        const src = thumbSrc(item.src), have = index.images.find(i => i.pg.replace(/_\d+$/, '') === pg);
        if (have) have.src ||= src;
        else index.images.push({ pg, order: item.order, src });
      }
    }
    for (const r of Array.isArray(saved.ranges) ? saved.ranges : []) {
      if (Array.isArray(r) && r.length === 2 && r.every(n => Number.isSafeInteger(n) && n >= 0)
        && r[0] <= r[1] && !index.ranges.some(i => i[0] === r[0] && i[1] === r[1])) index.ranges.push(r);
    }
    index.images.sort((a, b) => a.order - b.order);
    index.ranges.sort((a, b) => a[0] - b[0]);
    index.ranges = index.ranges.reduce((merged, r) => {
      const last = merged.at(-1);
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
      return merged;
    }, []);
  }
  function initialize() {
  if (document.getElementById('pbv-toggle')) return;
  const style = document.createElement('style');
  style.textContent = `
    #pbv-view { position:fixed;inset:56px 0 0;z-index:2147483646;
      overflow:auto;background:var(--pbv-bg,#fff);overscroll-behavior:contain;overflow-anchor:none; }
    #pbv-view[hidden] { display:none!important; }
    #pbv-view.pbv-padded { box-sizing:border-box;padding-bottom:var(--pbv-sheet,0px); }
    #pbv-pages { padding:0 var(--pbv-pad,28px);margin:auto;width:min(900px,100%);box-sizing:border-box;
      display:flex;flex-direction:column;align-items:center;gap:0; }
    #pbv-pages > .pbv-sheet { flex:none;position:relative;display:block;
      overflow:hidden;background:transparent; }
    #pbv-pages > .pbv-horizontal { width:min(900px,100%)!important;height:auto!important;
      box-sizing:border-box;padding:0;direction:ltr!important; }
    #pbv-pages .pbv-horizontal, #pbv-pages .pbv-horizontal * {
      writing-mode:horizontal-tb!important;-webkit-writing-mode:horizontal-tb!important;
      text-orientation:mixed!important; }
    #pbv-pages .pbv-horizontal reader-rendered-page,
    #pbv-pages .pbv-horizontal div, #pbv-pages .pbv-horizontal p {
      display:block!important;position:static!important;transform:none!important;
      width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;
      max-width:none!important;max-height:none!important;overflow:visible!important;
      columns:auto!important;float:none!important;clip:auto!important;clip-path:none!important;
      text-align:start!important;white-space:normal!important;line-height:var(--pbv-lh,1.9)!important; }
    #pbv-pages .pbv-horizontal div { margin:0!important;padding:0!important; }
    /* リーダー側の本文ページには左右24pxの余白が付いている。余白はスライダーだけで決める。 */
    #pbv-pages .pbv-horizontal reader-rendered-page { padding-left:0!important;padding-right:0!important; }
    #pbv-pages .pbv-horizontal p { margin:0 0 0.7em!important;padding:0!important;
      text-indent:0!important;overflow-wrap:anywhere; }
    #pbv-pages .pbv-horizontal p:has(>br:only-child) { display:none!important; }
    /* 文字色・書体・サイズ・背景はリーダーの設定を読み取って反映する（syncTheme） */
    #pbv-pages .pbv-horizontal, #pbv-pages .pbv-horizontal .gb-segment {
      color:var(--pbv-fg,inherit)!important;font-family:var(--pbv-font,inherit)!important; }
    /* ダークモード等でリーダー側が個別に付けた文字色・背景・フィルターは、複製側では使わず統一する */
    #pbv-pages .pbv-horizontal, #pbv-pages .pbv-horizontal :not(img):not(svg):not(svg *) {
      color:var(--pbv-fg,inherit)!important;-webkit-text-fill-color:var(--pbv-fg,currentcolor)!important;
      background:none!important;text-shadow:none!important;filter:none!important;mix-blend-mode:normal!important; }
    /* ダークモードのリーダーは、ページ全体を色反転して暗くし、画像だけ再度反転して元の色に戻している。
       複製側ではページの反転を外すので、画像側の反転も外す（残すと画像だけ色が反転する）。 */
    #pbv-pages .pbv-horizontal img, #pbv-pages .pbv-horizontal svg, #pbv-pages .pbv-horizontal svg * { filter:none!important; }
    #pbv-pages .pbv-horizontal .gb-segment { font-size:var(--pbv-size,18px)!important; }
    #pbv-pages .pbv-horizontal [style*="display:none"],
    #pbv-pages .pbv-horizontal [style*="display: none"] { display:none!important; }
    #pbv-pages .pbv-horizontal img { max-width:100%;height:auto; }
    /* 操作ボタンはリーダーのヘッダー直下の1行にまとめ、本文に重ねない（スマホ対応） */
    /* 操作は右下の「☰」から。押すと下からパネルが開く（大きいボタン・見出し付き）。 */
    #pbv-images { position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;
      display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:var(--pbv-ui,#222);font:14px/1.4 sans-serif; }
    #pbv-images > * { pointer-events:auto; }
    #pbv-images:not(.pbv-open) { bottom:60px;padding-right:12px;box-sizing:border-box; }
    #pbv-menu { flex:none;width:46px;height:46px;border-radius:50%;border:1px solid #8886;margin-right:12px;
      background:var(--pbv-bg,#fff);color:var(--pbv-ui,#222);font-size:22px;cursor:pointer;
      box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.85; }
    #pbv-images:not(.pbv-open) #pbv-menu { margin-right:0;opacity:.6; }
    #pbv-images span { align-self:center;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      padding:6px 12px;border-radius:14px;background:var(--pbv-bg,#fff);color:var(--pbv-ui,#222);
      border:1px solid #8886;font:13px sans-serif; }
    #pbv-images span:empty { display:none; }
    #pbv-images:not(.pbv-open) > span { animation:pbv-fade 4s forwards; }
    @keyframes pbv-fade { 0%,70% { opacity:1; } 100% { opacity:0;visibility:hidden; } }
    #pbv-panel { width:100%;box-sizing:border-box;display:grid;gap:8px;max-height:60vh;overflow:auto;
      padding:12px 12px calc(12px + env(safe-area-inset-bottom));
      background:var(--pbv-bg,#fff);border-top:1px solid #8886;border-radius:18px 18px 0 0;
      box-shadow:0 -4px 18px rgba(0,0,0,.3); }
    #pbv-images:not(.pbv-open) #pbv-panel { display:none; }
    #pbv-panel .pbv-row { display:flex;gap:8px; }
    #pbv-panel .pbv-row > * { flex:1 1 0;min-width:0; }
    #pbv-panel .pbv-field[hidden] { display:none; }
    #pbv-panel label { display:block;margin:0 0 4px;font-size:12px;opacity:.75; }
    #pbv-panel button, #pbv-panel select { box-sizing:border-box;width:100%;min-height:42px;padding:0 8px;
      border:1px solid #8886;border-radius:12px;background:var(--pbv-bg,#fff);color:var(--pbv-ui,#222);
      font:14px sans-serif;cursor:pointer;text-overflow:ellipsis; }
    #pbv-panel button:disabled { opacity:.45;cursor:default; }
    #pbv-panel input[type=range] { width:100%;min-height:28px;margin:0; }
    #pbv-panel #pbv-speak { min-height:50px;font-size:17px;font-weight:bold;background:#1a73e8;border-color:#1a73e8;color:#fff; }
    #pbv-panel #pbv-speak.on { background:#d93025;border-color:#d93025; }
    #pbv-panel .pbv-seg { display:flex;padding:3px; }
    #pbv-panel .pbv-seg span { flex:1;display:flex;align-items:center;justify-content:center;border-radius:9px;
      font-size:13px;white-space:nowrap;opacity:.7; }
    #pbv-panel .pbv-seg span.on { background:#1a73e8;color:#fff;font-weight:bold;opacity:1; }
    #pbv-panel .pbv-row > button:not(#pbv-speak) { padding:0 4px;font-size:13px; }
    #pbv-panel button[aria-expanded="true"] {
      background:#e8f0fe;border-color:#1a73e8;color:#1a73e8; }
    reader-account-indicator, reader-app-bar button[aria-label*="全画面"],
    reader-app-bar button[aria-label="その他のオプション"], reader-app-bar button[aria-label="More options"] { display:none!important; }
    body.pbv-quiet .overflow-menu-dialog-container, body.pbv-quiet .cdk-overlay-backdrop { visibility:hidden!important; }
    #pbv-display { position:static;flex:none;width:40px;height:40px;margin:0;padding:0;border:0;border-radius:50%;
      background:transparent;font:bold 17px sans-serif;cursor:pointer; }
    #pbv-menu.pbv-bar { position:static;flex:none;width:40px;height:40px;margin:0;border:0;border-radius:50%;
      background:transparent;box-shadow:none;opacity:1;font-size:22px; }
    .gb-segment p.pbv-tts { background:rgba(26,115,232,.22)!important; }
    #pbv-gallery { position:fixed;left:8px;top:64px;max-height:calc(100% - 72px - var(--pbv-sheet,0px));z-index:2147483647;
      width:min(420px,calc(100% - 16px));box-sizing:border-box;overflow:auto;padding:8px;
      display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;align-content:start;
      background:var(--pbv-bg,#fff);border:1px solid #1a73e8;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.25); }
    #pbv-gallery[hidden] { display:none!important; }
    #pbv-gallery button { display:flex;flex-direction:column;gap:4px;padding:4px;border:1px solid #8886;
      border-radius:6px;background:transparent;color:var(--pbv-ui,#222);cursor:pointer;font:12px sans-serif; }
    #pbv-gallery img { width:100%;aspect-ratio:3/4;object-fit:cover;background:#8884; }
    #pbv-pages .pbv-horizontal p.pbv-tts { background:rgba(26,115,232,.22)!important; }
    #pbv-pages .pbv-horizontal svg { display:block;width:100%!important;
      height:auto!important;max-width:100%; }
  `;
  document.head.append(style);
  const toggle = document.createElement('button');
  toggle.id = 'pbv-toggle';
  toggle.className = 'pbv-seg';
  const segNormal = document.createElement('span'), segVertical = document.createElement('span');
  segNormal.textContent = '通常表示'; segVertical.textContent = '縦表示';
  toggle.append(segNormal, segVertical);
  const showMode = on => {
    segNormal.classList.toggle('on', !on); segVertical.classList.toggle('on', on);
    toggle.setAttribute('aria-pressed', String(on));
  };
  showMode(false);
  const view = document.createElement('section');
  view.id = 'pbv-view';
  view.hidden = true;
  view.setAttribute('aria-label', '上下スクロール読書');
  const pages = document.createElement('div');
  pages.id = 'pbv-pages';
  view.append(pages);
  document.body.append(view);
  const imageTools = document.createElement('nav');
  imageTools.id = 'pbv-images';
  imageTools.hidden = false;
  imageTools.setAttribute('aria-label', '挿絵へ移動');
  const list = document.createElement('button'), gallery = document.createElement('div');
  const back = document.createElement('button'), menu = document.createElement('button');
  const status = document.createElement('span');
  gallery.id = 'pbv-gallery';
  gallery.hidden = true;
  menu.id = 'pbv-menu';
  menu.hidden = true;   // バーに置けるまで隠す（右下に一瞬出ないように）
  menu.textContent = '☰';
  menu.setAttribute('aria-label', '操作メニュー');
  back.textContent = '元の位置';
  back.disabled = true;
  status.setAttribute('role', 'status');
  const mk = (tag, id, text) => { const e = document.createElement(tag); if (id) e.id = id; if (text) e.textContent = text; return e; };
  const row = (...kids) => { const d = mk('div'); d.className = 'pbv-row'; d.append(...kids); return d; };
  const field = (title, control) => {
    const d = mk('div'); d.className = 'pbv-field';
    const l = mk('label', 0, title); d.append(l, control); d.label = l; return d;
  };
  const speak = mk('button', 'pbv-speak', '▶ 読み上げ'), rateInput = mk('input');
  const engineSel = mk('select'), voiceSel = mk('select');
  Object.assign(rateInput, { type: 'range', min: '0.5', max: '2.5', step: '0.1' });
  const padInput = mk('input');
  Object.assign(padInput, { type: 'range', min: '0', max: '80', step: '1' });
  const padField = field('', padInput);
  const rateField = field('', rateInput), engineField = field('読み上げエンジン', engineSel);
  const voiceField = field('声', voiceSel);
  const panel = mk('div', 'pbv-panel');
  const modeRow = row(list, toggle, back);
  modeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1.9fr 1fr';
  panel.append(modeRow, row(speak), rateField, row(engineField, voiceField), padField);
  imageTools.append(status, menu, panel);
  const displayBtn = mk('button', 'pbv-display', 'Aa');
  displayBtn.setAttribute('aria-label', '表示オプション');
  document.body.append(imageTools, gallery);
  let active = false, busy = false, timeout, debounce, direction = 1, lastSignature = '', lastScroll = 0;
  let ended = {};
  let context, pendingJump, landing, focusImage;
  let index = streamed;
  const seen = new Set();
  refresh = () => { saveIndex(); renderList(); };
  // 取得済みの挿絵位置をサムネ付きで一覧にする。押すとその挿絵へ直接移動する。
  function renderList() {
    const n = index.images.length;
    list.textContent = `挿絵${n ? ' ' + n : '…'} ${gallery.hidden ? '▾' : '▴'}`;
    list.setAttribute('aria-expanded', String(!gallery.hidden));
    if (!gallery.hidden) fillGallery();
  }
  function fillGallery() {
    const signature = index.images.map(item => item.pg + (item.src ? '+' : '')).join();
    if (gallery.dataset.signature === signature) return;
    gallery.dataset.signature = signature;
    gallery.replaceChildren(...index.images.map((item, i) => {
      const button = document.createElement('button');
      button.dataset.pg = item.pg;
      if (item.src) {
        const img = new Image();
        img.loading = 'lazy'; img.alt = ''; img.src = item.src;
        button.append(img);
      }
      button.append(`挿絵 ${i + 1}`);
      return button;
    }));
  }
  function gotoImage(pg) {
    if (busy) return;
    if (!context) { status.textContent = '本文の読み込みを待っています'; return; }
    busy = true; list.disabled = true; back.disabled = false;
    status.textContent = '挿絵へ移動…';
    pendingJump = () => window.parent.postMessage({ type: 'pbv-goto', pg, mode: active }, 'https://play.google.com');
    window.parent.postMessage({ type: 'pbv-mark', mode: active }, 'https://play.google.com');
    timeout = setTimeout(() => { pendingJump = null; finish('位置を保存できませんでした。再試行'); }, 3000);
  }
  // 上下の端に近づいたら次・前のページを自動で読み込む。
  function fill() {
    if (!active || busy || landing) return;
    const top = view.scrollTop < 180, bottom = view.scrollHeight - view.scrollTop - view.clientHeight < 180;
    if (top && !ended[-1]) load(-1);
    else if (bottom && !ended[1]) load(1);
  }
  function imageLocation(page) {
    const image = [...page.querySelectorAll('img, svg image')].find(isIllustration);
    if (!image) return null;
    const anchors = [...page.querySelectorAll('[id]')].filter(a => /^GBS\./.test(a.id)
      && (a.compareDocumentPosition(image) & 4));
    const pg = (anchors.at(-1)?.id || pageLocation(page)).replace(/_\d+$/, '');
    return order(pg) === null ? null : { pg, order: order(pg) };
  }
  function isIllustration(img) {
    const rect = img.getBoundingClientRect();
    const clip = img.closest?.('reader-rendered-page')?.getBoundingClientRect();
    if (clip) return Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left) >= 200
      && Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top) >= 200;
    return Math.max(rect.width, Number(img.getAttribute('width')) || 0, img.naturalWidth || 0) >= 200
      && Math.max(rect.height, Number(img.getAttribute('height')) || 0, img.naturalHeight || 0) >= 200;
  }
  function pageLocation(page) {
    return page.querySelector('.gb-segment')?.getAttribute('ocean-position')?.replace(/\+(\d+)$/, '_$1')
      || page.querySelector('[id^="GBS."]')?.id || '';
  }
  function saveIndex() {
    if (!context) return;
    window.parent.postMessage({ type: 'pbv-index', index }, 'https://play.google.com');
  }
  function rememberImages() {
    for (const page of document.querySelectorAll('reader-pages reader-page.-gb-loaded')) {
      const found = imageLocation(page);
      if (found && !index.images.some(item => item.pg === found.pg)) index.images.push(found);
    }
    index.images.sort((a, b) => a.order - b.order);
    saveIndex();
    renderList();
  }
  window.addEventListener('message', event => {
    if (event.origin !== 'https://play.google.com' || event.source !== window.parent) return;
    if (event.data?.type === 'pbv-marked') {
      clearTimeout(timeout);
      const begin = pendingJump;
      pendingJump = null;
      begin?.();
      return;
    }
    if (event.data?.type !== 'pbv-context') return;
    context = event.data;
    if (manifest && manifest.metadata.volume_id !== context.id) return;
    mergeIndex(index, context.index);
    rememberImages();
    if (typeof context.landing === 'string' && /^GBS\.[A-Za-z0-9_.+-]{1,180}$/.test(context.landing))
      landing = { signature: '', steps: 0 };
    if (context.bookmark) back.disabled = false;
    if (context.mode && !active) toggle.click();
    if (landing) setTimeout(append, 350);
  });
  window.parent.postMessage({ type: 'pbv-context' }, 'https://play.google.com');
  renderList();

  function shown() {
    return [...document.querySelectorAll('reader-pages reader-page.shown')]
      .filter(p => p.classList.contains('-gb-loaded') && p.querySelector('reader-rendered-page'));
  }
  function resize() {
    // 画像ページは、左右の余白（画面幅で変わる）を除いた幅に収める。
    const padding = parseFloat(getComputedStyle(pages).paddingLeft) * 2;
    for (const sheet of pages.children) {
      sheet.style.zoom = sheet.classList.contains('pbv-horizontal') ? '1'
        : String(Math.min(1, (view.clientWidth - padding - 4) / Number(sheet.dataset.width)));
    }
  }
  // リーダーが今表示している本文の文字色・書体・サイズ・背景を、縦表示へ反映する。
  function syncTheme() {
    const page = shown().find(p => p.querySelector('.gb-segment p'));
    if (!page) return;
    const text = [...page.querySelectorAll('.gb-segment p')]
      .reduce((a, b) => b.textContent.length > a.textContent.length ? b : a);
    const style = getComputedStyle(text), size = parseFloat(style.fontSize);
    const rgb = c => c.match(/[\d.]+/g)?.map(Number) ?? [];
    let bg;
    for (let el = text; el && !bg; el = el.parentElement || el.getRootNode().host) {
      const [r, g, b, a = 1] = rgb(getComputedStyle(el).backgroundColor);
      if (r !== undefined && a > 0.5) bg = `rgb(${r}, ${g}, ${b})`;
    }
    const [r, g, b] = rgb(style.color);
    // 背景が取れず文字が明るい場合は、読めなくならないよう暗い背景にする。
    bg ||= (r + g + b) / 3 > 128 ? 'rgb(17, 17, 17)' : 'rgb(255, 255, 255)';
    // 背景と文字を別々の要素から読むため食い違うことがある。追加UIは常に背景に対して読める色にし、
    // 本文も文字色が背景と近すぎる場合はその色に置き換える。
    const lum = ([x, y, z]) => (0.2126 * x + 0.7152 * y + 0.0722 * z) / 255;
    const ui = lum(rgb(bg)) > 0.5 ? '#222' : '#eee';
    const fg = Math.abs(lum(rgb(bg)) - lum([r, g, b])) >= 0.4 ? style.color : ui;
    // 行の高さ: リーダーの設定100%が文字の約2.625倍。その割合を、縦表示の標準1.9倍に掛け合わせる。
    // ponytail: 2.625 は実測値（本によって違う場合は表示オプションの％と少しずれる）。
    const ratio = parseFloat(style.lineHeight) / size;
    const lh = ratio > 0 && isFinite(ratio) ? Math.min(3.5, Math.max(1.2, 1.9 * ratio / 2.625)).toFixed(3) : '';
    for (const el of [view, imageTools, gallery]) {
      el.style.setProperty('--pbv-bg', bg);
      el.style.setProperty('--pbv-ui', ui);
      el.style.setProperty('--pbv-fg', fg);
      el.style.setProperty('--pbv-font', style.fontFamily);
      if (size >= 10 && size <= 60) el.style.setProperty('--pbv-size', `${size}px`);
      if (lh) el.style.setProperty('--pbv-lh', lh);
    }
  }
  function append() {
    rememberImages();
    if (adjustLanding()) return;
    if (!active) return;
    syncTheme();
    const height = view.scrollHeight, top = view.scrollTop;
    const visible = shown();
    const signature = visible.map(p => p.id).join('|');
    let added = false, reset = false;
    if (!busy && seen.size && visible.length && visible.every(p => !seen.has(p.id))) {
      // 目次やリンクでリーダーが離れた位置へ移動した。縦表示を作り直す。
      pages.replaceChildren(); seen.clear(); ended = {};
      reset = true;
    }
    // ponytail: 保持ページ数に比例してメモリを使う。長時間読む場合は表示を一度閉じて再開。
    for (const source of visible) {
      if (seen.has(source.id)) continue;
      const rect = source.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const sheet = source.cloneNode(true);
      sheet.classList.remove('shown');
      sheet.classList.add('pbv-sheet');
      if (source.classList.contains('text-mode')) sheet.classList.add('pbv-horizontal');
      sheet.dataset.width = String(rect.width);
      sheet.dataset.page = source.id;
      const segment = source.querySelector('.gb-segment');
      sheet.dataset.continues = String(/\+[1-9]\d*$/.test(segment?.getAttribute('ocean-position') || ''));
      sheet.style.cssText = `width:${rect.width}px;height:${rect.height}px;direction:${getComputedStyle(source).direction}`;
      for (const el of [sheet, ...sheet.querySelectorAll('[id]')]) el.removeAttribute('id');
      sheet.querySelectorAll('reader-page-overlay, reader-icon-overlay, script').forEach(el => el.remove());
      // 複製したリンクはリーダー本来の処理を失うので、クリック時に元のリンクを探せるよう印を付ける。
      sheet.querySelectorAll('a').forEach((a, i) => { a.dataset.pbvPage = source.id; a.dataset.pbvIndex = i; });
      const after = [...pages.children].find(p => p.dataset.page.localeCompare(source.id, undefined, { numeric: true }) > 0);
      pages.insertBefore(sheet, after || null);
      seen.add(source.id);
      added = true;
    }
    if (added) {
      // Googleが示す段落途中のオフセットがある場合だけ、前ページの段落につなぐ。
      const sheets = [...pages.children];
      for (let i = 1; i < sheets.length; i++) {
        const current = sheets[i];
        if (current.dataset.continues !== 'true' || current.dataset.joined) continue;
        const paragraphs = p => [...p.querySelectorAll('p')].filter(el => el.textContent.trim());
        const left = sheets.slice(0, i).flatMap(paragraphs).at(-1), right = paragraphs(current)[0];
        if (left && right) {
          left.append(...right.childNodes);
          right.remove();
          current.dataset.joined = 'true';
        }
      }
      clearTimeout(timeout);
      busy = false;
      list.disabled = false;
      if (status.textContent.startsWith('本文の読み込み')) status.textContent = '';
      resize();
      if (reset) { direction = 1; view.scrollTop = 0; }
      if (focusImage) {
        // 着地直後は、挿絵が画面に入るようにスクロールする。
        focusImage = false;
        const img = [...pages.querySelectorAll('img, svg')].find(el => el.getBoundingClientRect().width >= 200);
        if (img) view.scrollTop += img.getBoundingClientRect().top - view.getBoundingClientRect().top - 64;
      }
      if (!reset && direction === -1) view.scrollTop = top + view.scrollHeight - height;
      lastScroll = view.scrollTop;
      fill();
    } else if (busy && signature && signature !== lastSignature) {
      step();
    }
  }
  function finish(message) {
    clearTimeout(timeout);
    if (landing) {
      landing = null;
      window.parent.postMessage({ type: 'pbv-landed' }, 'https://play.google.com');
    }
    pendingJump = null;
    busy = false;
    status.textContent = message;
    list.disabled = false;
  }
  function adjustLanding() {
    if (!landing) return false;
    const visible = shown();
    if (!visible.length || visible.length !== document.querySelectorAll('reader-pages reader-page.shown').length) return true;
    if (visible.some(page => [...page.querySelectorAll('img, svg image')].some(isIllustration))) {
      finish('挿絵に移動しました'); focusImage = active; status.textContent = '挿絵に移動しました'; return false;
    }
    const signature = visible.map(page => page.id).join('|');
    if (signature === landing.signature) return true;
    // アンカー直後の画像が次の見開きに送られた場合だけ、最大2回補正する。
    if (landing.steps >= 2) {
      finish('挿絵の直前に移動しました'); status.textContent = '挿絵の直前に移動しました'; return false;
    }
    landing.signature = signature; landing.steps++;
    busy = true; direction = 1;
    list.disabled = true;
    status.textContent = '挿絵の表示位置を調整…';
    step();
    return true;
  }
  function pageButton(dir) {
    const label = dir === -1 ? '前のページ' : '次のページ';
    const english = dir === -1 ? 'Previous page' : 'Next page';
    return document.querySelector(`reader-app button[aria-label="${label}"], reader-app button[aria-label="${english}"]`);
  }
  function step() {
    const label = direction === -1 ? '前のページ' : '次のページ';
    const button = pageButton(direction);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      ended[direction] = true;
      finish(`${label}がありません`);
      return;
    }
    lastSignature = shown().map(p => p.id).join('|');
    clearTimeout(timeout);
    button.click();
    timeout = setTimeout(() => finish('追加できませんでした。再試行'), 10000);
  }
  function load(value) {
    if (!active || busy) return;
    direction = value;
    busy = true;
    list.disabled = true;
    step();
  }
  // 読み上げ。縦表示でも通常のページ表示でも使える。アプリ内（PBNative）なら端末TTSのエンジン・声を選べる。
  // ponytail: 強調は段落単位。文単位の強調は Range＋CSS.highlights が必要。
  const store = (k, v) => { try { v === undefined ? (v = localStorage.getItem(k)) : localStorage.setItem(k, v); } catch {} return v; };
  let rate = Number(store('pbv-rate')) || 1, voiceName = store('pbv-voice') || '';
  let speaking = false, token = 0, current = null, quick = 0, uid = 0, nativeInfo = null;
  const synth = window.speechSynthesis;
  // PlayBook アプリ（WebView）内なら、端末のTTSをアプリ側で直接使う（画面オフでも継続できる）。
  const native = window.PBNative, waiting = {};
  const post = o => native.postMessage(JSON.stringify(o));
  if (native) native.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.e === 'info') {
      nativeInfo = m; fillSelects();
      if (status.textContent.startsWith('エンジンを切り替え')) status.textContent = '';
      return;
    }
    if (m.e === 'voice') { status.textContent = `声: ${m.m}`; return; }
    const w = waiting[m.id];
    delete waiting[m.id];
    if (m.e === 'end') w?.done(); else if (m.e === 'error') w?.fail(m.m);
  };
  const webVoices = () => (synth?.getVoices() ?? []).filter(v => /^ja/i.test(v.lang));
  function fillSelects() {
    const fill = (sel, items, cur) => sel.replaceChildren(...items.map(([v, t]) => {
      const o = new Option(t, v); o.selected = v === cur; return o;
    }));
    if (native) {
      fill(engineSel, (nativeInfo?.engines ?? []).map(x => [x.n, x.l]), nativeInfo?.engine);
      fill(voiceSel, (nativeInfo?.voices ?? []).map(x => [x.n, x.l]), nativeInfo?.voice);
    } else {
      const list = webVoices(), cur = list.find(v => v.name === voiceName) || list[0];
      fill(voiceSel, list.map(v => [v.name, v.name]), cur?.name);
    }
    engineField.hidden = !native || !engineSel.options.length;
    voiceField.hidden = !voiceSel.options.length;
  }
  function uiLabels() {
    rateField.label.textContent = `読み上げ速度 ${rate.toFixed(1)}倍`;
    rateInput.value = rate;
    speak.textContent = speaking ? '■ 停止' : '▶ 読み上げ';
    speak.classList.toggle('on', speaking);
  }
  const hasText = p => p.textContent.trim();
  // 縦表示中は複製した本文、通常表示中はリーダーが今表示している本文を読む。
  function paragraphs() {
    return (active ? [...pages.querySelectorAll('.pbv-horizontal p')]
      : shown().flatMap(pg => [...pg.querySelectorAll('.gb-segment p')])).filter(hasText);
  }
  // ルビ（rt/rp）は除き、漢字側を読む。
  function plain(p) {
    const copy = p.cloneNode(true);
    copy.querySelectorAll('rt, rp').forEach(el => el.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }
  function stopSpeech() {
    speaking = false; token++;
    document.querySelectorAll('.pbv-tts').forEach(el => el.classList.remove('pbv-tts'));
    current = null;
    synth?.cancel(); uiLabels();
    if (native) { post({ c: 'stop' }); for (const k in waiting) delete waiting[k]; }
  }
  // 通常表示で、読み終えたら次のページへ進み、表示が切り替わるのを待って続きを読む。
  function turnPage(me) {
    const button = pageButton(1);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      stopSpeech(); status.textContent = '最後まで読み上げました'; return;
    }
    const before = shown().map(p => p.id).join('|');
    button.click();
    let n = 0;
    (function wait() {
      if (me !== token) return;
      const now = shown().map(p => p.id).join('|');
      if (now && now !== before) { current = null; setTimeout(() => nextParagraph(me), 300); return; }
      if (++n > 40) { stopSpeech(); status.textContent = 'ページを送れませんでした'; return; }
      setTimeout(wait, 250);
    })();
  }
  function nextParagraph(me) {
    if (me !== token) return;
    const list = paragraphs(), i = current ? list.indexOf(current) : -1;
    let next = list[i + 1];
    if (i < 0 && !current && active) {
      // 縦表示の開始位置: 表示領域の上端以降で最初の段落
      const top = view.getBoundingClientRect().top;
      next = list.find(p => p.getBoundingClientRect().bottom > top + 40);
    }
    if (!next) {
      if (!active) return turnPage(me);
      // 縦表示の末尾に達した。次ページを読み込み、追加されるまで待つ。
      if (ended[1]) { stopSpeech(); status.textContent = '最後まで読み上げました'; return; }
      load(1); setTimeout(() => nextParagraph(me), 600); return;
    }
    current?.classList.remove('pbv-tts');
    current = next; next.classList.add('pbv-tts');
    if (active) {
      next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (list.length - list.indexOf(next) < 4) load(1);   // 先読み
    }
    const sentences = plain(next).match(/[^。！？!?]+[。！？!?]*[」』）)]*/g) || [];
    if (native) {
      // 段落の文をまとめて端末TTSのキューへ渡す。読んでいる間に次の文を作らせ、文と文の間の無音を減らす。
      // ponytail: 段落をまたぐ先読みはしない（強調・スクロール・ページ送りが段落単位のため）。
      sentences.forEach((t, k) => {
        const id = ++uid, last = k === sentences.length - 1;
        waiting[id] = {
          done: () => { if (last) nextParagraph(me); },
          fail: m => { stopSpeech(); status.textContent = `読み上げエラー: ${m}`; },
        };
        post({ c: 'speak', id, t, r: rate });
      });
      if (!sentences.length) nextParagraph(me);
      return;
    }
    (function say(k) {
      if (me !== token) return;
      if (k >= sentences.length) return nextParagraph(me);
      const u = new SpeechSynthesisUtterance(sentences[k]), v = webVoices().find(x => x.name === voiceName) || webVoices()[0];
      u.lang = 'ja-JP'; u.rate = rate; if (v) u.voice = v;
      const t0 = Date.now();
      u.onend = () => {
        // 音が出ないまま即終了する環境では、高速で先へ進まず原因を表示して止める。
        if (Date.now() - t0 < 120 && sentences[k].length > 8 && ++quick >= 3) {
          stopSpeech(); status.textContent = `音が出ません（声${synth?.getVoices().length ?? 0}件）`; return;
        }
        say(k + 1);
      };
      u.onerror = e => {
        if (/canceled|interrupted/.test(e.error)) return;
        stopSpeech(); status.textContent = `読み上げエラー: ${e.error}（声${synth?.getVoices().length ?? 0}件）`;
      };
      synth.speak(u);
    })(0);
  }
  speak.addEventListener('click', () => {
    if (!synth && !native) { status.textContent = 'この環境は読み上げ非対応です'; return; }
    if (speaking) { stopSpeech(); return; }
    // 表示モードは変えない。縦表示なら縦のまま、通常表示なら通常のまま読む。
    speaking = true; token++; current = null; quick = 0; uiLabels();
    setTimeout(() => nextParagraph(token), 300);
  });
  rateInput.addEventListener('input', () => { rate = Number(rateInput.value); store('pbv-rate', rate); uiLabels(); });
  engineSel.addEventListener('change', () => {
    if (speaking) stopSpeech();
    post({ c: 'engine', n: engineSel.value }); status.textContent = 'エンジンを切り替え中…';
  });
  voiceSel.addEventListener('change', () => {
    if (native) post({ c: 'voice', n: voiceSel.value }); else { voiceName = voiceSel.value; store('pbv-voice', voiceName); }
  });
  synth?.addEventListener?.('voiceschanged', fillSelects);
  if (native) post({ c: 'info' });
  fillSelects();
  uiLabels();
  // 縦表示の左右の余白（px）。既定はスマホ幅で狭く、広い画面で広く。
  // ponytail: 保存キーを pbv-pad2 にしたのは、旧版（ページ側の24pxを含む値）と意味が違うため。
  const savedPad = store('pbv-pad2');
  let pad = savedPad === null || savedPad === '' ? (innerWidth <= 600 ? 27 : 52) : Number(savedPad);
  const applyPad = () => {
    document.documentElement.style.setProperty('--pbv-pad', `${pad}px`);
    padField.label.textContent = `縦表示の左右の余白 ${pad}px`;
    padInput.value = pad;
    resize();
  };
  padInput.addEventListener('input', () => { pad = Number(padInput.value); store('pbv-pad2', pad); applyPad(); });
  applyPad();
  toggle.addEventListener('click', () => {
    if (speaking) stopSpeech();   // 表示モードが変わるので読み上げを止める
    active = !active;
    view.hidden = !active;
    showMode(active);
    imageTools.classList.remove('pbv-open');
    view.classList.remove('pbv-padded');
    menu.textContent = '☰'; gallery.hidden = true;   // パネルを閉じた状態に戻す
    document.documentElement.style.setProperty('--pbv-sheet', '0px');
    clearTimeout(timeout);
    busy = false;
    pendingJump = null;
    back.disabled = !context?.bookmark;
    status.textContent = '';
    list.disabled = false;
    if (active) {
      pages.replaceChildren();
      seen.clear();
      ended = {};
      direction = 1;
      if (!shown().length) status.textContent = '本文の読み込みを待っています…';
      append();
      view.scrollTop = 0;
      lastScroll = 0;
    }
  });
  // パネルが開いている間だけ、その高さ分を縦表示とギャラリーの下端から空ける。
  const sheet = () => document.documentElement.style.setProperty('--pbv-sheet',
    imageTools.classList.contains('pbv-open') ? `${panel.offsetHeight + 54}px` : '0px');
  new ResizeObserver(sheet).observe(panel);
  menu.addEventListener('click', () => {
    const open = imageTools.classList.toggle('pbv-open');
    view.classList.toggle('pbv-padded', open);
    menu.textContent = open ? '✕' : '☰';
    if (!open) gallery.hidden = true;
    sheet();
    renderList();
  });
  list.addEventListener('click', () => {
    gallery.hidden = !gallery.hidden;
    renderList();
  });
  gallery.addEventListener('click', event => {
    const pg = event.target.closest('button')?.dataset.pg;
    if (!pg) return;
    gallery.hidden = true;
    renderList();
    gotoImage(pg);
  });
  // 複製ページのリンクをそのまま開くと403になる。既定の遷移を止め、リーダー内の元のリンクを押し直す。
  pages.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const source = [...document.querySelectorAll('reader-pages reader-page')].find(p => p.id === link.dataset.pbvPage);
    const original = source?.querySelectorAll('a')[Number(link.dataset.pbvIndex)];
    if (original) original.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    else status.textContent = 'このリンクは通常表示で開いてください';
  }, true);
  back.addEventListener('click', () => {
    if (context) window.parent.postMessage({ type: 'pbv-return' }, 'https://play.google.com');
  });
  view.addEventListener('scroll', () => {
    const delta = view.scrollTop - lastScroll;
    lastScroll = view.scrollTop;
    // ユーザーが端へ向かってスクロールした場合は、終端判定をやり直す。
    if (delta) { ended[delta < 0 ? -1 : 1] = false; fill(); }
  }, { passive: true });
  // リーダーの仮想ページ更新だけを監視し、自分が追加したページは監視しない。
  function watch() {
    const reader = document.querySelector('reader-pages');
    if (!reader) return false;
    new MutationObserver(() => {
      clearTimeout(debounce);
      // 読込完了したページだけを使い、探索中の待ち時間を短くする。
      debounce = setTimeout(append, busy ? 100 : 350);
    }).observe(reader, { childList: true, subtree: true, attributes: true, characterData: true });
    return true;
  }
  if (!watch()) {
    const startup = new MutationObserver(() => {
      if (watch()) { startup.disconnect(); append(); }
    });
    startup.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('resize', resize);
  // ponytail: 配色変更はページ更新を伴わないことがあるため、1秒ごとに設定を読み直す。
  // 右上のアカウントアイコン（CSSで非表示）の位置に、表示オプションとメニューのボタンを置く。
  // バーが無いとき（全画面表示など）は、メニューだけ右下に浮かせる。
  function placeMenu() {
    const slot = document.querySelector('reader-app-bar .nav-group.end');
    if (slot) {
      if (menu.parentElement !== slot || displayBtn.parentElement !== slot) {
        slot.append(displayBtn, menu); menu.classList.add('pbv-bar');
      }
      const ref = slot.querySelector('button:not(#pbv-menu):not(#pbv-display)');
      if (ref) menu.style.color = displayBtn.style.color = getComputedStyle(ref).color;
      menu.hidden = false;
    } else {
      displayBtn.remove();
      if (menu.parentElement !== imageTools) {
        menu.classList.remove('pbv-bar'); menu.style.color = '';
        imageTools.insertBefore(menu, panel);
      }
      // 起動直後はバーがまだ描画されていない。4秒待ってもバーが無い（全画面など）ときだけ右下に出す。
      menu.hidden = Date.now() - startedAt < 4000;
    }
  }
  const startedAt = Date.now();
  // 非表示にした「⋮」を裏で押して、中の「表示オプション」を開く。開いている間にもう一度押すと閉じる。
  const displayPane = () => [...document.querySelectorAll('.cdk-overlay-pane.-gb-titled-dialog')]
    .find(p => /表示オプション|Display options/i.test(p.textContent));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  displayBtn.addEventListener('click', async () => {
    const opened = displayPane();
    if (opened) {
      const close = [...opened.querySelectorAll('button')].find(b => /^\s*close\s*$/i.test(b.textContent)
        || /閉じる|close/i.test(b.getAttribute('aria-label') || ''));
      if (close) close.click();
      else opened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return;
    }
    const more = document.querySelector('reader-app-bar button[aria-label="その他のオプション"], reader-app-bar button[aria-label="More options"]');
    if (!more) { status.textContent = '表示オプションを開けません'; return; }
    document.body.classList.add('pbv-quiet');   // 「⋮」のメニューだけ見せない
    more.click();
    for (let i = 0; i < 40; i++) {
      await wait(15);
      const item = document.querySelector('.cdk-overlay-container .display-options-link')
        || [...document.querySelectorAll('.cdk-overlay-container button')].find(b => /表示オプション|Display options/i.test(b.textContent));
      if (item) { item.click(); break; }
    }
    // メニューが消えるまで隠す。表示オプション自体は隠さないので、出た瞬間に見える。
    for (let i = 0; i < 40 && document.querySelector('.overflow-menu-dialog-container'); i++) await wait(15);
    document.body.classList.remove('pbv-quiet');
  });
  placeMenu();
  // バーが描画された瞬間に置く（1秒待たない）。
  let placeFrame = 0;
  new MutationObserver(() => {
    if (!placeFrame) placeFrame = requestAnimationFrame(() => { placeFrame = 0; placeMenu(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { syncTheme(); placeMenu(); }, 1000);
  }
})();
