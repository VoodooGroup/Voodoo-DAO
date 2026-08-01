/**
 * Modern white centered dialogs — identical UX to VoodooBank-V4 UiModal.
 * No browser alert(), no red status banner for wallet errors.
 */
window.VoodooUI = (function () {
  const NOT_DETECTED_MSG =
    'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.';

  let root = null;
  let titleEl = null;
  let messageEl = null;
  let actionsEl = null;
  let iconEl = null;
  let resolveFn = null;

  function ensureDom() {
    if (root) return;

    root = document.createElement('div');
    root.id = 'voodooUiModal';
    root.className = 'voodoo-ui-modal hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'voodooUiTitle');
    root.innerHTML = [
      '<div class="voodoo-ui-backdrop" data-ui-dismiss="1"></div>',
      '<div class="voodoo-ui-panel" role="document">',
      '  <div class="voodoo-ui-icon" id="voodooUiIcon" aria-hidden="true"></div>',
      '  <h2 class="voodoo-ui-title" id="voodooUiTitle"></h2>',
      '  <p class="voodoo-ui-message" id="voodooUiMessage"></p>',
      '  <div class="voodoo-ui-actions" id="voodooUiActions"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(root);
    titleEl = root.querySelector('#voodooUiTitle');
    messageEl = root.querySelector('#voodooUiMessage');
    actionsEl = root.querySelector('#voodooUiActions');
    iconEl = root.querySelector('#voodooUiIcon');

    root.addEventListener('click', (e) => {
      if (e.target && e.target.getAttribute('data-ui-dismiss') === '1') {
        close(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) {
        close(false);
      }
    });
  }

  function iconFor(type) {
    if (type === 'success') return '✓';
    if (type === 'warning' || type === 'error') return '!';
    return 'i';
  }

  function close(result) {
    if (!root) return;
    root.classList.add('hidden');
    document.body.classList.remove('voodoo-ui-open');
    if (actionsEl) actionsEl.innerHTML = '';
    const fn = resolveFn;
    resolveFn = null;
    if (fn) fn(result);
  }

  function show(opts) {
    ensureDom();
    const {
      title = 'Notice',
      message = '',
      type = 'info',
      okText = 'OK',
      cancelText = null,
    } = opts || {};

    return new Promise((resolve) => {
      if (resolveFn) close(false);
      resolveFn = resolve;

      root.classList.remove('hidden');
      root.dataset.type = type;
      document.body.classList.add('voodoo-ui-open');

      if (iconEl) {
        iconEl.textContent = iconFor(type);
        iconEl.dataset.type = type;
      }
      if (titleEl) titleEl.textContent = title;
      if (messageEl) messageEl.textContent = String(message || '');

      actionsEl.innerHTML = '';

      if (cancelText) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'voodoo-ui-btn voodoo-ui-btn-ghost';
        cancel.textContent = cancelText;
        cancel.addEventListener('click', () => close(false));
        actionsEl.appendChild(cancel);
      }

      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'voodoo-ui-btn voodoo-ui-btn-primary';
      ok.textContent = okText;
      ok.addEventListener('click', () => close(true));
      actionsEl.appendChild(ok);

      setTimeout(() => ok.focus(), 0);
    });
  }

  /**
   * Exact copy of VoodooBank-V4 normalizeNotify → UiModal.
   * @returns {{title,message,type,okText}|null} null = silent (user cancel)
   */
  function normalizeNotify(message, variant = 'error') {
    const raw = String(message || '').trim();
    if (!raw) return null;

    if (
      /cancelled in wallet|connection cancelled|user rejected|user denied|rejected the request|ACTION_REJECTED/i.test(
        raw
      ) ||
      raw === '4001'
    ) {
      return null;
    }

    let type = variant === 'success' ? 'success' : variant === 'info' ? 'info' : 'error';
    let title = type === 'success' ? 'Success' : type === 'info' ? 'Info' : 'Notice';
    let msg = raw;

    if (type === 'success' || /lock successful|locked \d|unlocked successfully/i.test(raw)) {
      title = 'Success';
      type = 'success';
    } else if (/not detected|not ready/i.test(raw)) {
      // Same popup as Bank / Plinko / Miner
      title = 'Voodoo Wallet';
      type = 'error';
      msg = NOT_DETECTED_MSG;
    } else if (/failed|error|could not/i.test(raw) && type !== 'success') {
      title = 'Something went wrong';
      type = 'error';
    }

    return { title, message: msg, type, okText: 'OK' };
  }

  function notifyWalletError(rawMessage) {
    const normalized = normalizeNotify(rawMessage, 'error');
    if (!normalized) return Promise.resolve(false);
    return show(normalized);
  }

  function alert(message, options) {
    const opts =
      typeof options === 'string'
        ? { title: options, message }
        : { message, ...(options || {}) };
    return show({
      title: opts.title || 'Notice',
      message: opts.message || String(message || ''),
      type: opts.type || 'error',
      okText: opts.okText || 'OK',
    });
  }

  // Faucet-style event bus
  if (typeof window !== 'undefined') {
    window.addEventListener('voodoo-ui-alert', (e) => {
      const d = e?.detail || {};
      const n = normalizeNotify(d.message || '', d.type || 'error');
      if (!n) return;
      if (d.title) n.title = d.title;
      if (d.okText) n.okText = d.okText;
      show(n);
    });
  }

  return {
    NOT_DETECTED_MSG,
    show,
    alert,
    normalizeNotify,
    notifyWalletError,
    close: () => close(false),
  };
})();
