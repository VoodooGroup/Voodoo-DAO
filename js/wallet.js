/**
 * Dual wallet connect for VoodooDAO — same UX as Plinko / Faucet / VoodooBank:
 * - Voodoo Wallet → browser extension (EIP-6963 + globals)
 * - Other → RainbowKit modal (MetaMask, WalletConnect, Rabby, …)
 *
 * Exposes window.VoodooWallet (shared API) + window.DAO_WALLET (ethers v6 state).
 */
window.VoodooWallet = (function () {
  const VOODOO_RDNS = 'app.voodoowallet';
  const VOODOO_INSTALL_URL = 'https://github.com/VoodooGroup/Voodoo-Wallet-Extension';
  const PULSE_CHAIN_ID = 369;
  const PULSE_CHAIN_HEX = '0x171';

  let listenersBound = false;
  /** @type {any} */
  let activeProvider = null;
  /** @type {'voodoo'|'injected'|'rainbow'|null} */
  let activeWalletKind = null;
  let voodooConnectGen = 0;
  let pendingRainbowConnect = null;
  let pendingReject = null;
  let connectEpoch = 0;

  function pulsechainNetwork() {
    const c = window.DAO_CONFIG || {};
    return {
      chainId: c.PULSECHAIN_ID || PULSE_CHAIN_HEX,
      chainName: c.CHAIN_NAME || 'PulseChain',
      nativeCurrency: c.NATIVE || { name: 'Pulse', symbol: 'PLS', decimals: 18 },
      rpcUrls: [c.RPC_URL || 'https://rpc.pulsechain.com'],
      blockExplorerUrls: [c.EXPLORER || 'https://scan.pulsechain.com'],
    };
  }

  function isVoodooProvider(provider) {
    if (!provider) return false;
    if (provider.isVoodooWallet === true || provider._isVoodooWallet === true) return true;
    if (provider === window.voodooEthereum || provider === window.VoodooWalletProvider) return true;
    if (
      typeof provider.providerInfo?.rdns === 'string' &&
      provider.providerInfo.rdns.toLowerCase() === VOODOO_RDNS
    ) {
      return true;
    }
    return false;
  }

  function listInjectedProviders() {
    if (typeof window === 'undefined') return [];
    if (window.location.protocol === 'file:') return [];
    const found = [];
    const push = (p) => {
      if (p && !found.includes(p)) found.push(p);
    };
    push(window.voodooEthereum);
    push(window.VoodooWalletProvider);
    const { ethereum } = window;
    if (ethereum) {
      if (Array.isArray(ethereum.providers) && ethereum.providers.length) {
        ethereum.providers.forEach(push);
      }
      push(ethereum);
    }
    return found;
  }

  function discoverVoodooViaEip6963(timeoutMs = 900) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(null);
        return;
      }
      let found = null;
      let settled = false;
      function finish(provider) {
        if (settled) return;
        settled = true;
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        resolve(provider || null);
      }
      function onAnnounce(event) {
        const detail = event.detail;
        const info = detail?.info;
        const provider = detail?.provider;
        if (!provider) return;
        const rdns = String(info?.rdns || '').toLowerCase();
        const name = String(info?.name || '');
        if (rdns === VOODOO_RDNS || /voodoo\s*wallet/i.test(name) || isVoodooProvider(provider)) {
          found = provider;
          finish(found);
        }
      }
      window.addEventListener('eip6963:announceProvider', onAnnounce);
      try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      } catch {
        /* ignore */
      }
      setTimeout(() => finish(found), timeoutMs);
    });
  }

  function findVoodooSync() {
    if (window.voodooEthereum && isVoodooProvider(window.voodooEthereum)) return window.voodooEthereum;
    if (window.VoodooWalletProvider && isVoodooProvider(window.VoodooWalletProvider)) {
      return window.VoodooWalletProvider;
    }
    return listInjectedProviders().find(isVoodooProvider) || null;
  }

  async function getVoodooWalletProvider() {
    const sync = findVoodooSync();
    if (sync) return sync;
    return discoverVoodooViaEip6963(900);
  }

  function getMetaMaskProvider() {
    const providers = listInjectedProviders();
    if (!providers.length) return null;
    const mm = providers.find((p) => p.isMetaMask && !isVoodooProvider(p));
    if (mm) return mm;
    const other = providers.find((p) => !isVoodooProvider(p));
    return other || providers[0];
  }

  async function readChainId(ethereum) {
    try {
      if (ethereum.chainId != null) {
        const raw = ethereum.chainId;
        if (typeof raw === 'string' && raw.startsWith('0x')) return parseInt(raw, 16);
        if (typeof raw === 'number') return raw;
      }
      const hex = await ethereum.request({ method: 'eth_chainId' });
      return parseInt(hex, 16);
    } catch {
      return null;
    }
  }

  async function switchToPulseChain(ethereum) {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: PULSE_CHAIN_HEX }],
      });
    } catch (switchErr) {
      if (switchErr?.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [pulsechainNetwork()],
        });
      } else {
        throw switchErr;
      }
    }
  }

  function mapRequestError(err, kind) {
    const msg = String(err?.message || err || '');
    const code = err?.code;
    if (code === 4001 || /user rejected|rejected the request|ACTION_REJECTED/i.test(msg)) {
      return new Error('Connection was cancelled in your wallet.');
    }
    if (code === 'VOODOO_TIMEOUT' || /timed out|timeout|no response/i.test(msg)) {
      return new Error(
        'Voodoo Wallet did not respond. Open the extension, unlock, then try again.'
      );
    }
    if (code === 4100 || /unlock voodoo wallet first|wallet locked/i.test(msg)) {
      return new Error('Voodoo Wallet is locked. Unlock the extension, then try again.');
    }
    if (code === 'VOODOO_NOT_FOUND' || /not detected/i.test(msg)) {
      const e = new Error(
        'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page.'
      );
      e.code = 'VOODOO_NOT_FOUND';
      e.installUrl = VOODOO_INSTALL_URL;
      return e;
    }
    return err instanceof Error ? err : new Error(msg);
  }

  function requestVoodooAccounts(ethereum, { isCurrent, timeoutMs = 120_000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, val) => {
        if (settled) return;
        if (typeof isCurrent === 'function' && !isCurrent()) {
          settled = true;
          clearTimeout(hardTimer);
          return;
        }
        settled = true;
        clearTimeout(hardTimer);
        if (ok) resolve(val);
        else reject(val);
      };
      const hardTimer = setTimeout(() => {
        const err = new Error('Voodoo Wallet did not respond. Click Voodoo Wallet again.');
        err.code = 'VOODOO_TIMEOUT';
        finish(false, err);
      }, timeoutMs);
      ethereum
        .request({ method: 'eth_requestAccounts' })
        .then((accs) => finish(true, accs || []))
        .catch((err) => finish(false, err));
    });
  }

  /**
   * Build ethers v6 BrowserProvider + Signer from an injected EIP-1193 provider.
   */
  async function connectWithProvider(ethereum, kind, onStatus) {
    if (!ethereum) {
      if (window.location.protocol === 'file:') {
        throw new Error(
          'Open this site over https (or http://localhost). Extensions do not work on file:// pages.'
        );
      }
      throw mapRequestError(
        Object.assign(
          new Error(
            kind === 'voodoo'
              ? 'Voodoo Wallet was not detected. Install or reload the extension, then refresh this page.'
              : 'No browser wallet was found. Install MetaMask or another wallet and try again.'
          ),
          { code: kind === 'voodoo' ? 'VOODOO_NOT_FOUND' : undefined }
        ),
        kind
      );
    }

    let accounts;
    try {
      onStatus?.('requesting');
      const withTimeout = (p, ms) =>
        Promise.race([
          p,
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error(
                kind === 'voodoo'
                  ? 'Voodoo Wallet did not respond. Unlock the extension and try again.'
                  : 'Wallet did not respond. Try again.'
              );
              err.code = 'VOODOO_TIMEOUT';
              reject(err);
            }, ms);
          }),
        ]);

      if (kind === 'voodoo') {
        accounts = await requestVoodooAccounts(ethereum, {
          isCurrent: ethereum.__voodooIsCurrent,
          timeoutMs: 90_000,
        });
      } else {
        try {
          accounts = await ethereum.request({ method: 'eth_accounts' });
        } catch {
          accounts = [];
        }
        if (!accounts?.length) {
          accounts = await withTimeout(ethereum.request({ method: 'eth_requestAccounts' }), 90_000);
        }
      }
      onStatus?.('connected');
    } catch (err) {
      throw mapRequestError(err, kind);
    }

    if (!accounts?.length) {
      throw new Error('No account was returned. Unlock the wallet and try again.');
    }

    let chainId = await readChainId(ethereum);
    if (chainId !== PULSE_CHAIN_ID) {
      try {
        await switchToPulseChain(ethereum);
        await new Promise((r) => setTimeout(r, 400));
        chainId = await readChainId(ethereum);
      } catch (e) {
        console.warn('Chain switch attempt:', e?.message || e);
      }
      if (chainId !== PULSE_CHAIN_ID && kind !== 'voodoo' && kind !== 'rainbow') {
        throw new Error('Please switch your wallet to PulseChain (chain ID 369) and try again.');
      }
    }

    // ethers v6
    const browserProvider = new ethers.BrowserProvider(ethereum, 'any');
    const signer = await browserProvider.getSigner();
    let userAddress = accounts[0];
    try {
      const fromSigner = await signer.getAddress();
      if (fromSigner) userAddress = fromSigner;
    } catch {
      /* use accounts[0] */
    }

    activeProvider = ethereum;
    activeWalletKind = kind;

    return {
      ethereum,
      provider: browserProvider,
      signer,
      userAddress,
      walletKind: kind,
    };
  }

  function waitForRainbowReady(maxMs = 15000) {
    if (window.VoodooRainbow?.ready && window.VoodooRainbow.openConnectModal) {
      return Promise.resolve(window.VoodooRainbow);
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      function check() {
        if (window.VoodooRainbow?.ready && window.VoodooRainbow.openConnectModal) {
          cleanup();
          resolve(window.VoodooRainbow);
          return;
        }
        if (Date.now() - started >= maxMs) {
          cleanup();
          reject(new Error('RainbowKit is still loading. Refresh the page and try again.'));
        }
      }
      function onReady() {
        check();
      }
      function cleanup() {
        window.removeEventListener('voodoo:rainbow-ready', onReady);
        clearInterval(timer);
      }
      window.addEventListener('voodoo:rainbow-ready', onReady);
      const timer = setInterval(check, 100);
      check();
    });
  }

  function cancelPendingRainbow(reason = 'cancelled') {
    if (typeof pendingReject === 'function') {
      const err = new Error(reason);
      err.code = 'ACTION_REJECTED';
      try {
        pendingReject(err);
      } catch {
        /* ignore */
      }
    }
    pendingReject = null;
    pendingRainbowConnect = null;
  }

  async function connectOther(onStatus) {
    onStatus?.('opening');
    await waitForRainbowReady();

    if (activeProvider && activeWalletKind === 'rainbow') {
      try {
        return await connectWithProvider(activeProvider, 'rainbow', onStatus);
      } catch {
        clearActiveWallet();
      }
    }

    if (pendingRainbowConnect) cancelPendingRainbow('restart');

    const epoch = ++connectEpoch;

    pendingRainbowConnect = new Promise((resolve, reject) => {
      let settled = false;
      pendingReject = reject;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (pendingReject === reject) pendingReject = null;
        window.removeEventListener('voodoo:rainbow-connected', onConnected);
        window.removeEventListener('voodoo:rainbow-error', onError);
      };

      const timer = setTimeout(() => {
        if (settled || epoch !== connectEpoch) return;
        cleanup();
        const err = new Error('Wallet connection timed out. Click Other to try again.');
        err.code = 'TIMEOUT';
        reject(err);
      }, 180_000);

      async function onConnected(event) {
        if (settled || epoch !== connectEpoch) return;
        const detail = event?.detail || {};
        const provider = detail.provider;
        const preAddress = detail.address;
        if (!provider) {
          cleanup();
          reject(new Error('Wallet connected but no provider was returned.'));
          return;
        }
        cleanup();
        try {
          onStatus?.('connected');
          const result = await connectWithProvider(provider, 'rainbow', onStatus);
          if (!result.userAddress && preAddress) result.userAddress = preAddress;
          resolve(result);
        } catch (err) {
          clearActiveWallet();
          try {
            await window.VoodooRainbow?.hardReset?.();
          } catch {
            /* ignore */
          }
          reject(mapRequestError(err, 'rainbow'));
        }
      }

      function onError(event) {
        if (settled || epoch !== connectEpoch) return;
        cleanup();
        reject(new Error(event?.detail?.message || 'Wallet connection failed.'));
      }

      window.addEventListener('voodoo:rainbow-connected', onConnected);
      window.addEventListener('voodoo:rainbow-error', onError);
    }).finally(() => {
      if (epoch === connectEpoch) {
        pendingRainbowConnect = null;
        pendingReject = null;
      }
    });

    return pendingRainbowConnect;
  }

  async function connectVoodoo(onStatus) {
    const gen = ++voodooConnectGen;
    const isCurrent = () => gen === voodooConnectGen;

    onStatus?.('detecting');
    const ethereum = await getVoodooWalletProvider();
    if (!ethereum) {
      const err = new Error(
        'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page.'
      );
      err.code = 'VOODOO_NOT_FOUND';
      err.installUrl = VOODOO_INSTALL_URL;
      throw err;
    }
    if (!isCurrent()) {
      const err = new Error('restart');
      err.code = 'ACTION_REJECTED';
      throw err;
    }

    onStatus?.('opening');
    clearActiveWallet();
    ethereum.__voodooIsCurrent = isCurrent;

    try {
      return await connectWithProvider(ethereum, 'voodoo', onStatus);
    } finally {
      try {
        delete ethereum.__voodooIsCurrent;
      } catch {
        /* ignore */
      }
    }
  }

  /** Injected MetaMask / other (no Rainbow) — fallback if Rainbow fails */
  async function connectInjected(onStatus) {
    const eth =
      getMetaMaskProvider() || window.ethereum || window.voodooEthereum || null;
    if (!eth) {
      throw new Error('No browser wallet found. Install MetaMask or Voodoo Wallet.');
    }
    const kind = isVoodooProvider(eth) ? 'voodoo' : 'injected';
    clearActiveWallet();
    return connectWithProvider(eth, kind, onStatus);
  }

  function getActiveProvider() {
    return activeProvider || findVoodooSync() || getMetaMaskProvider();
  }

  function getActiveWalletKind() {
    return activeWalletKind;
  }

  function clearActiveWallet() {
    activeProvider = null;
    activeWalletKind = null;
  }

  function bindListeners(onAccountsChanged, onChainChanged) {
    const ethereum = getActiveProvider();
    if (!ethereum) return;
    if (listenersBound && ethereum === activeProvider) return;
    listenersBound = true;
    try {
      ethereum.on('accountsChanged', (accounts) => {
        if (!accounts?.length) {
          clearActiveWallet();
          onAccountsChanged?.(null);
          return;
        }
        onAccountsChanged?.(accounts[0]);
      });
      ethereum.on('chainChanged', () => {
        onChainChanged?.();
      });
    } catch (e) {
      console.warn('Wallet event listeners not supported', e);
    }
  }

  return {
    getMetaMaskProvider,
    getVoodooWalletProvider,
    isVoodooProvider,
    connect: connectOther,
    connectOther,
    connectVoodoo,
    connectInjected,
    connectWithProvider,
    waitForRainbowReady,
    bindListeners,
    getActiveProvider,
    getActiveWalletKind,
    clearActiveWallet,
    cancelPendingRainbow,
    VOODOO_INSTALL_URL,
  };
})();

/**
 * DAO-facing wallet state (ethers v6 signer for contracts).
 */
window.DAO_WALLET = (() => {
  const state = {
    signer: null,
    userAddress: null,
    provider: null,
    ethereum: null,
    walletKind: null,
  };

  function applyResult(result) {
    state.provider = result.provider;
    state.signer = result.signer;
    state.userAddress = result.userAddress;
    state.ethereum = result.ethereum;
    state.walletKind = result.walletKind;
    return state;
  }

  function updateButtons() {
    const H = window.DAO_HELPERS;
    const voodooBtn = document.getElementById('voodooWalletBtn');
    const otherBtn = document.getElementById('connectBtn');
    const addr = state.userAddress;
    const kind = state.walletKind;

    if (!addr) {
      if (voodooBtn) {
        voodooBtn.textContent = 'Voodoo Wallet';
        voodooBtn.classList.remove('is-connected', 'connected');
        voodooBtn.disabled = false;
        voodooBtn.title = 'Connect with Voodoo Wallet browser extension';
      }
      if (otherBtn) {
        otherBtn.textContent = 'Other';
        otherBtn.classList.remove('is-connected', 'connected');
        otherBtn.disabled = false;
        otherBtn.title = 'Other wallets via RainbowKit (MetaMask, WalletConnect, …)';
      }
      return;
    }

    const short = H.shortAddr(addr);
    if (kind === 'voodoo') {
      if (voodooBtn) {
        voodooBtn.textContent = short;
        voodooBtn.classList.add('is-connected', 'connected');
        voodooBtn.disabled = false;
        voodooBtn.title = addr;
      }
      if (otherBtn) {
        otherBtn.textContent = 'Other';
        otherBtn.classList.remove('is-connected', 'connected');
        otherBtn.disabled = true;
      }
    } else {
      if (otherBtn) {
        otherBtn.textContent = short;
        otherBtn.classList.add('is-connected', 'connected');
        otherBtn.disabled = true;
        otherBtn.title = addr;
      }
      if (voodooBtn) {
        voodooBtn.textContent = 'Voodoo Wallet';
        voodooBtn.classList.remove('is-connected', 'connected');
        voodooBtn.disabled = true;
      }
    }

    document.getElementById('submit-proposal')?.removeAttribute('disabled');
    document.getElementById('token-management')?.classList.remove('hidden');
    document.getElementById('token-management-hint')?.classList.add('hidden');
  }

  function clearStatus() {
    window.DAO_HELPERS?.setLog('');
  }

  /**
   * Same as VoodooBank-V4 setError → UiModal / normalizeNotify.
   * Never use the red #error-log banner for wallet missing / connect errors.
   */
  function setError(message, variant = 'error') {
    clearStatus();
    if (!message) return Promise.resolve(false);

    if (window.VoodooUI?.normalizeNotify) {
      const normalized = window.VoodooUI.normalizeNotify(message, variant);
      if (!normalized) {
        // Quiet cancel (same as Bank)
        console.info('[VoodooGovernance]', message);
        return Promise.resolve(false);
      }
      return window.VoodooUI.show(normalized);
    }

    if (window.VoodooUI?.notifyWalletError) {
      return window.VoodooUI.notifyWalletError(message);
    }

    // Should not happen if ui.js is loaded
    window.dispatchEvent(
      new CustomEvent('voodoo-ui-alert', {
        detail: {
          title: 'Voodoo Wallet',
          message:
            window.VoodooUI?.NOT_DETECTED_MSG ||
            'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.',
          type: 'error',
          okText: 'OK',
        },
      })
    );
    return Promise.resolve(false);
  }

  async function connectVoodoo() {
    // Bank-style: no status banner while connecting — only white modal on failure
    clearStatus();
    try {
      const result = await window.VoodooWallet.connectVoodoo();
      applyResult(result);
      updateButtons();
      window.VoodooWallet.bindListeners(
        (a) => {
          if (!a) location.reload();
          else window.dispatchEvent(new CustomEvent('dao:wallet-accounts', { detail: { address: a } }));
        },
        () => location.reload()
      );
      clearStatus();
      return state;
    } catch (err) {
      console.error(err);
      clearStatus();
      // User cancelled — silent (same as Bank)
      if (
        err?.code === 4001 ||
        err?.code === 'ACTION_REJECTED' ||
        /reject|denied|cancel|dismiss/i.test(String(err?.message || ''))
      ) {
        return null;
      }
      // Not installed / not ready → exact Bank popup
      if (err?.code === 'VOODOO_NOT_FOUND' || /not detected|not ready/i.test(String(err?.message || ''))) {
        await setError(
          'Voodoo Wallet was not detected. Install the extension, open it and sign in, then refresh this page and try again.'
        );
      } else {
        await setError(err?.message || 'Voodoo Wallet connection failed');
      }
      return null;
    }
  }

  async function connectOther() {
    const H = window.DAO_HELPERS;
    H.setLog('Opening wallet options…');
    try {
      // Prefer RainbowKit (same as Plinko / Faucet)
      if (window.VoodooRainbow?.ready || true) {
        try {
          await window.VoodooWallet.waitForRainbowReady(12000);
          await window.VoodooRainbow.openConnectModal({
            mode: 'connect',
            forceConnect: true,
          });
          window.VoodooWallet.cancelPendingRainbow?.('restart');
          const result = await window.VoodooWallet.connectOther((s) => {
            if (s === 'opening') H.setLog('Select a wallet…');
            if (s === 'connected') H.setLog('Wallet connected, finishing…');
          });
          applyResult(result);
          updateButtons();
          window.VoodooWallet.bindListeners(
            (a) => {
              if (!a) location.reload();
              else window.dispatchEvent(new CustomEvent('dao:wallet-accounts', { detail: { address: a } }));
            },
            () => location.reload()
          );
          H.setLog('Wallet connected on PulseChain.');
          return state;
        } catch (e) {
          if (e?.code === 4001 || e?.code === 'ACTION_REJECTED' || /cancel/i.test(String(e?.message))) {
            H.setLog('Connection cancelled.');
            return null;
          }
          console.warn('Rainbow connect failed, trying injected fallback', e);
        }
      }

      // Fallback: injected MetaMask etc.
      const result = await window.VoodooWallet.connectInjected();
      applyResult(result);
      updateButtons();
      window.VoodooWallet.bindListeners(
        (a) => {
          if (!a) location.reload();
          else window.dispatchEvent(new CustomEvent('dao:wallet-accounts', { detail: { address: a } }));
        },
        () => location.reload()
      );
      H.setLog('Wallet connected on PulseChain.');
      return state;
    } catch (err) {
      console.error(err);
      H.setLog('Other wallet: ' + H.errMsg(err), true);
      return null;
    }
  }

  /** @deprecated single-button API */
  async function connect() {
    return connectOther();
  }

  return {
    state,
    connect,
    connectVoodoo,
    connectOther,
    updateButtons,
    applyResult,
  };
})();
