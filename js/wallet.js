/**
 * Wallet connect + PulseChain switch
 */
window.DAO_WALLET = (() => {
  const state = {
    signer: null,
    userAddress: null,
    provider: null,
  };

  async function ensurePulseChain() {
    const { PULSECHAIN_ID, RPC_URL, EXPLORER, CHAIN_NAME, NATIVE } = window.DAO_CONFIG;
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId === PULSECHAIN_ID) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: PULSECHAIN_ID }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: PULSECHAIN_ID,
              chainName: CHAIN_NAME,
              nativeCurrency: NATIVE,
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [EXPLORER],
            },
          ],
        });
      } else {
        throw switchError;
      }
    }
  }

  async function connect() {
    const H = window.DAO_HELPERS;
    if (!window.ethereum) {
      H.setLog('No wallet found. Install MetaMask or another Web3 wallet.', true);
      return null;
    }
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await ensurePulseChain();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      state.provider = provider;
      state.signer = signer;
      state.userAddress = userAddress;

      const btn = document.getElementById('connect-wallet');
      if (btn) {
        btn.textContent = H.shortAddr(userAddress);
        btn.title = userAddress;
      }
      document.getElementById('submit-proposal')?.removeAttribute('disabled');
      document.getElementById('token-management')?.classList.remove('hidden');
      document.getElementById('token-management-hint')?.classList.add('hidden');
      H.setLog('Wallet connected on PulseChain.');
      return state;
    } catch (err) {
      console.error(err);
      H.setLog('Connection failed: ' + H.errMsg(err), true);
      return null;
    }
  }

  function bindListeners(onReconnect) {
    if (!window.ethereum) return;
    window.ethereum.on?.('accountsChanged', (accounts) => {
      if (!accounts || accounts.length === 0) location.reload();
      else onReconnect?.();
    });
    window.ethereum.on?.('chainChanged', () => location.reload());
  }

  return { state, connect, ensurePulseChain, bindListeners };
})();
