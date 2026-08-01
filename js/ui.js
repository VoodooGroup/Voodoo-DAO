/**
 * Modern in-dapp dialogs (centered white modal).
 * Same UX as StakingPlatform / VoodooBank / Faucet / Plinko — no browser alert().
 */
window.VoodooUI = (function () {
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

  /**
   * @param {object} opts
   * @returns {Promise<boolean>}
   */
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

  /** Same mapping as Bank normalizeNotify for wallet errors */
  function notifyWalletError(rawMessage) {
    const raw = String(rawMessage || '').trim();
    if (!raw) return Promise.resolve(false);

    // User cancelled — silent (same as Bank)
    if (
      /cancelled in wallet|connection cancelled|user rejected|user denied|rejected the request|ACTION_REJECTED/i.test(
        raw
      ) ||
      raw === '4001'
    ) {
      return Promise.resolve(false);
    }

    let type = 'error';
    let title = 'Notice';
    let message = raw;

    if (/not detected|not ready/i.test(raw)) {
      // 1:1 copy with Staking / Bank / Faucet / Plinko
      title = 'Voodoo Wallet';
      type = 'error';
      message =
        'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.';
    } else if (/failed|error|could not/i.test(raw)) {
      title = 'Something went wrong';
      type = 'error';
    } else {
      title = 'Voodoo Wallet';
      type = 'error';
    }

    return show({ title, message, type, okText: 'OK' });
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

  return {
    show,
    alert,
    notifyWalletError,
    close: () => close(false),
  };
})();
