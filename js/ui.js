// Bottom sheets, toasts and confirm dialogs.
import { $, esc, icon } from './util.js';

const stack = [];

export function openSheet({ title = '', body = '', cls = '', onMount, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head">
        <div class="grabber" aria-hidden="true"></div>
        <h2>${esc(title)}</h2>
        <button class="icon-btn sheet-x" aria-label="סגירה">${icon('x')}</button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  const sheet = wrap.querySelector('.sheet');
  const bodyEl = wrap.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  $('#sheet-root').append(wrap);
  document.body.classList.add('sheet-open');

  let closed = false;
  const entry = { close: () => finish(false) };
  stack.push(entry);
  history.pushState({ sheet: stack.length }, '');

  function finish(fromPop) {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!stack.length) {
        document.body.classList.remove('sheet-open');
        window.dispatchEvent(new Event('sheets-closed'));
      }
    }, 220);
    if (!fromPop) history.back();
    onClose?.();
  }
  entry.popClose = () => finish(true);

  wrap.querySelector('.sheet-backdrop').addEventListener('click', () => finish(false));
  wrap.querySelector('.sheet-x').addEventListener('click', () => finish(false));

  // Drag the header down to dismiss.
  const head = wrap.querySelector('.sheet-head');
  let y0 = null, dy = 0;
  head.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
  head.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  head.addEventListener('touchend', () => {
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) finish(false);
    y0 = null;
  });

  requestAnimationFrame(() => wrap.classList.add('open'));
  onMount?.(bodyEl, entry.close, wrap);
  return { el: wrap, body: bodyEl, close: entry.close };
}

// The Android back button closes the top sheet instead of leaving the page.
window.addEventListener('popstate', () => {
  const top = stack[stack.length - 1];
  if (top) top.popClose();
});

// Removes open sheets without touching history (used when the route changes).
export const dropAllSheets = () => [...stack].reverse().forEach(s => s.popClose());

export function toast(msg, { action = null, onAction = null, ms = 3800 } = {}) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action)}</button>` : ''}`;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const kill = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-btn')?.addEventListener('click', () => { onAction?.(); kill(); });
  setTimeout(kill, ms);
}

export function confirmSheet({ title, text, ok = 'אישור', cancel = 'ביטול', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const s = openSheet({
      title,
      cls: 'sheet-small',
      body: `<p class="confirm-text">${esc(text)}</p>
        <div class="row-btns">
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
          <button class="btn btn-ghost" data-cancel>${esc(cancel)}</button>
        </div>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    s.body.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); s.close(); };
    s.body.querySelector('[data-cancel]').onclick = () => { answered = true; resolve(false); s.close(); };
  });
}
