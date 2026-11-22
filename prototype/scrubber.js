/* scrubber.js —— 预览区右侧的阅读进度滑轨（能拖、能点、能用键盘）
 *
 * 为什么自己做一条：Android WebView 和移动端浏览器的原生滚动条只是「指示器」，
 * 手指按上去拖不动（桌面端的系统滚动条可以，但窄屏看不出来、也抓不准）。
 * 所以这里画一条自己的轨道：拖动、点按跳转、方向键、翻页都接上。
 *
 * 两种模式自适应：
 *   inner —— 预览面板自己滚（宽屏，面板有固定高度）
 *   page  —— 整页滚（窄屏 / 手机上预览不设最大高度）
 */
(function (root) {
  'use strict';

  var rail = null, track = null, thumb = null, tip = null, scrollEl = null;
  var drag = null;          // { id, offset, railH, thumbH, span }
  var pending = false;

  function docEl() { return document.scrollingElement || document.documentElement; }

  function box() {
    if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 4) {
      return { kind: 'inner', top: scrollEl.scrollTop, view: scrollEl.clientHeight, total: scrollEl.scrollHeight };
    }
    var d = docEl();
    return { kind: 'page', top: d.scrollTop, view: root.innerHeight, total: d.scrollHeight };
  }

  // 轨道的实际高度：不能读自己（隐藏时是 0），按父容器/视口算
  function railHeight(isPage) {
    if (isPage) return Math.max(0, root.innerHeight - 12);
    var shell = rail.parentElement;
    var h = shell ? shell.clientHeight : 0;
    return Math.max(0, h - 16);
  }

  function geom() {
    if (!rail) return null;
    var b = box();
    var isPage = b.kind === 'page';
    rail.classList.toggle('fixed', isPage);
    if (b.total <= b.view + 4) return null;
    var railH = railHeight(isPage);
    if (railH < 48) return null;
    var thumbH = Math.round(b.view * b.view / b.total);
    if (thumbH < 32) thumbH = 32;
    if (thumbH > railH) thumbH = railH;
    return { b: b, railH: railH, thumbH: thumbH, span: railH - thumbH, maxTop: b.total - b.view };
  }

  function ratioOf(g) {
    return g.maxTop > 0 ? Math.min(1, Math.max(0, g.b.top / g.maxTop)) : 0;
  }

  function paint() {
    var g = geom();
    if (!g) { rail.hidden = true; rail.classList.remove('fixed', 'show-tip'); return; }
    rail.hidden = false;
    var r = ratioOf(g);
    thumb.style.height = g.thumbH + 'px';
    thumb.style.top = Math.round(r * g.span) + 'px';
    rail.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    if (rail.classList.contains('show-tip')) placeTip(g, r);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    (root.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      pending = false;
      paint();
    });
  }

  // 拖到哪儿，就顺手告诉你「读到第几条」
  function placeTip(g, r) {
    var pct = Math.round(r * 100) + '%';
    if (g.b.kind === 'inner' && scrollEl) {
      var msgs = scrollEl.querySelectorAll('.msg');
      if (msgs.length) {
        var topEdge = scrollEl.getBoundingClientRect().top + 8;
        for (var i = 0; i < msgs.length; i++) {
          if (msgs[i].getBoundingClientRect().bottom > topEdge) { pct += ' · 第 ' + (i + 1) + '/' + msgs.length + ' 条'; break; }
        }
      }
    }
    tip.textContent = pct;
    tip.style.top = Math.round(ratioOf(g) * g.span + g.thumbH / 2) + 'px';
  }

  function showTip() {
    var g = geom();
    if (!g) return;
    rail.classList.add('show-tip');
    placeTip(g, ratioOf(g));
  }

  function hideTip() { rail.classList.remove('show-tip'); }

  function scrollToRatio(r, smooth) {
    var g = geom();
    if (!g) return;
    r = Math.min(1, Math.max(0, r));
    var y = Math.round(r * g.maxTop);
    if (g.b.kind === 'inner') {
      if (smooth && scrollEl.scrollTo) scrollEl.scrollTo({ top: y, behavior: 'smooth' });
      else scrollEl.scrollTop = y;
    } else if (smooth) {
      root.scrollTo({ top: y, behavior: 'smooth' });
    } else {
      root.scrollTo(0, y);
    }
    paint();
  }

  function yInRail(ev) {
    return ev.clientY - rail.getBoundingClientRect().top;
  }

  function thumbTopPx() { return parseFloat(thumb.style.top || '0') || 0; }

  function onDown(ev) {
    var g = geom();
    if (!g) return;
    if (ev.button != null && ev.button !== 0) return;
    var y = yInRail(ev);
    var tTop = thumbTopPx();
    var onThumb = ev.target === thumb || (y >= tTop && y <= tTop + g.thumbH);
    drag = {
      id: ev.pointerId,
      offset: onThumb ? y - tTop : g.thumbH / 2,
      railH: g.railH, thumbH: g.thumbH, span: g.span
    };
    rail.classList.add('dragging');
    showTip();
    if (!onThumb) moveTo(y);
    try { rail.setPointerCapture(ev.pointerId); } catch (e) { /* 老浏览器没有 */ }
    ev.preventDefault();
  }

  function moveTo(y) {
    if (!drag) return;
    var t = y - drag.offset;
    if (t < 0) t = 0;
    if (t > drag.span) t = drag.span;
    scrollToRatio(drag.span > 0 ? t / drag.span : 0, false);
    showTip();
  }

  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    moveTo(yInRail(ev));
    ev.preventDefault();
  }

  function onUp(ev) {
    if (!drag || (ev && ev.pointerId !== drag.id)) return;
    drag = null;
    rail.classList.remove('dragging');
    try { rail.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    setTimeout(hideTip, 700);
  }

  function onKey(ev) {
    var g = geom();
    if (!g) return;
    var step = Math.max(40, Math.round(g.b.view * 0.85));
    var delta = 0;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown') delta = step;
    else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') delta = -step;
    else if (ev.key === 'Home') return scrollToRatio(0, false), ev.preventDefault();
    else if (ev.key === 'End') return scrollToRatio(1, false), ev.preventDefault();
    else return;
    ev.preventDefault();
    if (g.b.kind === 'inner') scrollEl.scrollTop = g.b.top + delta;
    else root.scrollTo(0, g.b.top + delta);
    showTip();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTip, 900);
    paint();
  }
  var hideTimer = 0;

  function init(opts) {
    scrollEl = opts.scrollEl;
    rail = opts.rail;
    track = rail.querySelector('.rail-track');
    thumb = rail.querySelector('.rail-thumb');
    tip = rail.querySelector('.rail-tip');

    rail.addEventListener('pointerdown', onDown);
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerup', onUp);
    rail.addEventListener('pointercancel', onUp);
    rail.addEventListener('pointerenter', function () { if (!drag) showTip(); });
    rail.addEventListener('pointerleave', function () { if (!drag) hideTip(); });
    rail.addEventListener('keydown', onKey);

    if (scrollEl) scrollEl.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    if (root.ResizeObserver && scrollEl) {
      try { new root.ResizeObserver(schedule).observe(scrollEl); } catch (e) { /* ignore */ }
    }
    // 内容换了一批（切文件、改对齐）之后要重新量
    refresh();
  }

  function refresh() { paint(); }

  root.ChatScrubber = { init: init, refresh: refresh, scrollToRatio: scrollToRatio };
})(window);
