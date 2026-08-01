/**
 * UI wiring + proposal tables for Voodoo Governance
 */
(async function boot() {
  const H = window.DAO_HELPERS;
  const W = window.DAO_WALLET;
  const C = window.DAO_CONTRACTS;
  const CFG = window.DAO_CONFIG;

  try {
    await C.loadAbis();
    C.initPublic();
  } catch (e) {
    console.error(e);
    H.setLog('Failed to load contract ABIs. Serve over http (npm start), not file://', true);
    return;
  }

  async function onConnected(state) {
    if (!state?.signer) return;
    C.bindSigner(state.signer);
    await C.loadUserTokenData(state.userAddress);
    await refreshAll();
  }

  // Voodoo Wallet button
  document.getElementById('voodooWalletBtn')?.addEventListener('click', async () => {
    if (W.state.userAddress && W.state.walletKind === 'voodoo') return;
    if (W.state.userAddress) return; // already connected via Other
    const s = await W.connectVoodoo();
    await onConnected(s);
  });

  // Other (RainbowKit / MetaMask / WC)
  document.getElementById('connectBtn')?.addEventListener('click', async () => {
    if (W.state.userAddress) return;
    const s = await W.connectOther();
    await onConnected(s);
  });

  // Account switch from extension
  window.addEventListener('dao:wallet-accounts', async (e) => {
    const addr = e.detail?.address;
    if (!addr || !W.state.ethereum) return;
    try {
      const provider = new ethers.BrowserProvider(W.state.ethereum, 'any');
      const signer = await provider.getSigner();
      W.state.provider = provider;
      W.state.signer = signer;
      W.state.userAddress = await signer.getAddress();
      W.updateButtons();
      C.bindSigner(W.state.signer);
      await C.loadUserTokenData(W.state.userAddress);
      await refreshAll();
    } catch (err) {
      console.error(err);
    }
  });

  window.approveVDO = async () => {
    if (await C.approveVDO()) {
      await C.loadUserTokenData(W.state.userAddress);
    }
  };

  window.unlockAllEligible = async () => {
    if (await C.unlockAllEligible()) {
      await C.loadUserTokenData(W.state.userAddress);
    }
  };

  document.getElementById('submit-proposal')?.addEventListener('click', async () => {
    if (!W.state.signer) return H.setLog('Connect wallet first.', true);
    const type = document.getElementById('proposal-type').value;
    const desc = document.getElementById('description').value.trim();
    if (!desc) return H.setLog('Description required.', true);

    let target = (
      type === 'whitelist'
        ? document.getElementById('new-target')
        : document.getElementById('target-address')
    ).value.trim();

    if (!ethers.isAddress(target)) return H.setLog('Invalid address.', true);
    target = ethers.getAddress(target);

    try {
      let data = document.getElementById('call-data').value.trim() || '0x';
      if (!data.startsWith('0x')) data = '0x' + data;
      await C.submitProposal({ type, target, data, desc });
      document.getElementById('description').value = '';
      document.getElementById('call-data').value = '';
      await C.loadUserTokenData(W.state.userAddress);
      await refreshAll();
    } catch (err) {
      H.setLog('Failed: ' + H.errMsg(err), true);
    }
  });

  document.getElementById('proposal-type').onchange = (e) => {
    const w = e.target.value === 'whitelist';
    document.getElementById('target-address').style.display = w ? 'none' : 'block';
    document.getElementById('call-data').style.display = w ? 'none' : 'block';
    document.getElementById('new-target').style.display = w ? 'block' : 'none';
  };

  // ─── Proposal tables ─────────────────────────────────────────
  async function loadActiveProposals() {
    const container = document.getElementById('proposal-list-active');
    const tbody = document.getElementById('active-body');
    container.innerHTML =
      '<p class="col-span-full text-center text-xl text-gray-300">Loading active proposals...</p>';
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center py-8 text-gray-300">Loading...</td></tr>';

    try {
      const all = await C.fetchAllProposals();
      if (!all.length) {
        container.innerHTML =
          '<p class="col-span-full text-center text-xl text-gray-300">No proposals yet.</p>';
        tbody.innerHTML =
          '<tr><td colspan="9" class="text-center py-8 text-gray-300">No active proposals.</td></tr>';
        return;
      }

      const now = Date.now() / 1000;
      const active = all.filter(
        (p) => !p.executed && !p.canceled && !p.queued && now < Number(p.endTime)
      );
      const readyToQueue = all.filter(
        (p) => !p.executed && !p.canceled && !p.queued && now >= Number(p.endTime)
      );

      let cardsHtml = '';
      let rowsHtml = '';

      for (const p of active) {
        const total = p.yes + p.no;
        cardsHtml += `
          <div class="proposal-card">
            <h3 class="text-2xl font-bold mb-3">Proposal #${p.id}</h3>
            <p class="text-gray-300 mb-4 whitespace-normal break-words">${H.escapeHtml(p.desc || 'No description')}</p>
            <p class="mb-2">Yes: <strong>${H.fmt(p.yes)}</strong> · No: <strong>${H.fmt(p.no)}</strong></p>
            <p class="mb-4">Status: <span class="status-active font-bold">Active</span></p>
            <p class="text-sm text-gray-400">Ends: ${new Date(Number(p.endTime) * 1000).toLocaleString()}</p>
            <p class="text-xs text-gray-500 mt-2">Target: ${H.shortAddr(p.target)}</p>
          </div>`;
        rowsHtml += `
          <tr>
            <td>#${p.id}</td>
            <td title="${p.proposer}">${H.shortAddr(p.proposer)}</td>
            <td class="max-w-xs truncate" title="${H.escapeAttr(p.desc || '')}">${H.escapeHtml(p.desc || '—')}</td>
            <td>${H.fmt(p.yes)}</td>
            <td>${H.fmt(p.no)}</td>
            <td>${H.fmt(total)}</td>
            <td class="status-active">Active</td>
            <td>${new Date(Number(p.endTime) * 1000).toLocaleString()}</td>
            <td class="vote-buttons">
              <button class="vote-yes" data-action="vote" data-id="${p.id}" data-support="true">Yes</button>
              <button class="vote-no" data-action="vote" data-id="${p.id}" data-support="false">No</button>
            </td>
          </tr>`;
      }

      for (const p of readyToQueue) {
        const total = p.yes + p.no;
        rowsHtml += `
          <tr>
            <td>#${p.id}</td>
            <td title="${p.proposer}">${H.shortAddr(p.proposer)}</td>
            <td class="max-w-xs truncate" title="${H.escapeAttr(p.desc || '')}">${H.escapeHtml(p.desc || '—')}</td>
            <td>${H.fmt(p.yes)}</td>
            <td>${H.fmt(p.no)}</td>
            <td>${H.fmt(total)}</td>
            <td class="status-ended">Ended</td>
            <td>${new Date(Number(p.endTime) * 1000).toLocaleString()}</td>
            <td class="vote-buttons">
              <button class="action-btn" data-action="queue" data-id="${p.id}">Queue</button>
            </td>
          </tr>`;
      }

      container.innerHTML = active.length
        ? cardsHtml
        : '<p class="col-span-full text-center text-xl text-gray-300">No active proposals currently.</p>';
      tbody.innerHTML =
        rowsHtml ||
        '<tr><td colspan="9" class="text-center py-8 text-gray-300">No active proposals.</td></tr>';
    } catch (err) {
      console.error(err);
      container.innerHTML = `<p class="col-span-full text-center text-xl text-red-400">Failed to load: ${H.escapeHtml(H.errMsg(err))}</p>`;
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center py-8 text-gray-300">Failed to load.</td></tr>';
    }
  }

  async function loadQueuedTable() {
    const tbody = document.getElementById('queued-body');
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center py-8 text-gray-300">Loading...</td></tr>';
    try {
      const all = await C.fetchAllProposals();
      const now = Math.floor(Date.now() / 1000);
      const queued = all.filter((p) => p.queued && !p.executed && !p.canceled);
      if (!queued.length) {
        tbody.innerHTML =
          '<tr><td colspan="9" class="text-center py-8 text-gray-300">No queued proposals.</td></tr>';
        return;
      }
      const timelock = Number(C.getCachedTimelock());
      let rows = '';
      for (const p of queued) {
        const total = p.yes + p.no;
        const readyAt = Number(p.queueTime) + timelock;
        const canExecute = now >= readyAt;
        rows += `
          <tr>
            <td>#${p.id}</td>
            <td title="${p.proposer}">${H.shortAddr(p.proposer)}</td>
            <td class="max-w-xs truncate" title="${H.escapeAttr(p.desc || '')}">${H.escapeHtml(p.desc || '—')}</td>
            <td>${H.fmt(p.yes)}</td>
            <td>${H.fmt(p.no)}</td>
            <td>${H.fmt(total)}</td>
            <td class="status-queued">${canExecute ? 'Ready' : 'Queued'}</td>
            <td>${p.queueTime && Number(p.queueTime) ? new Date(Number(p.queueTime) * 1000).toLocaleString() : '—'}</td>
            <td class="vote-buttons">
              <button class="action-btn execute" data-action="execute" data-id="${p.id}" ${canExecute ? '' : 'disabled'}>Execute</button>
            </td>
          </tr>`;
      }
      tbody.innerHTML = rows;
    } catch (err) {
      console.error(err);
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center py-8 text-gray-300">Failed to load queued.</td></tr>';
    }
  }

  async function loadHistoryTable() {
    const tbody = document.getElementById('history-body');
    tbody.innerHTML =
      '<tr><td colspan="9" class="text-center py-8 text-gray-300">Loading...</td></tr>';
    try {
      const all = await C.fetchAllProposals();
      if (!all.length) {
        tbody.innerHTML =
          '<tr><td colspan="9" class="text-center py-8 text-gray-300">No proposals yet.</td></tr>';
        return;
      }
      const now = Date.now() / 1000;
      let rowsHtml = '';
      for (let i = all.length - 1; i >= 0; i--) {
        const p = all[i];
        const total = p.yes + p.no;
        const status = H.statusOf(p, now);
        const statusClass =
          status === 'Executed'
            ? 'status-executed'
            : status === 'Canceled'
              ? 'status-canceled'
              : status === 'Queued'
                ? 'status-queued'
                : status === 'Active'
                  ? 'status-active'
                  : 'status-ended';
        rowsHtml += `
          <tr>
            <td>#${p.id}</td>
            <td title="${p.proposer}">${H.shortAddr(p.proposer)}</td>
            <td class="max-w-xs truncate" title="${H.escapeAttr(p.desc || '')}">${H.escapeHtml(p.desc || '—')}</td>
            <td>${H.fmt(p.yes)}</td>
            <td>${H.fmt(p.no)}</td>
            <td>${H.fmt(total)}</td>
            <td class="${statusClass}">${status}</td>
            <td>${new Date(Number(p.endTime) * 1000).toLocaleString()}</td>
            <td title="${p.target}">${H.shortAddr(p.target)}</td>
          </tr>`;
      }
      tbody.innerHTML = rowsHtml;
    } catch (err) {
      console.error(err);
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center py-8 text-gray-300">Failed to load history.</td></tr>';
    }
  }

  async function handleTableAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (!W.state.signer) return H.setLog('Connect wallet first.', true);
    if (btn.disabled) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const original = btn.textContent;
    btn.disabled = true;

    try {
      if (action === 'vote') {
        btn.textContent = 'Voting...';
        await C.vote(id, btn.dataset.support === 'true');
      } else if (action === 'queue') {
        btn.textContent = 'Queueing...';
        await C.queue(id);
      } else if (action === 'execute') {
        btn.textContent = 'Executing...';
        await C.execute(id);
      }
      await C.loadUserTokenData(W.state.userAddress);
      await refreshAll();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = original;
      H.setLog('Action failed: ' + H.errMsg(err), true);
    }
  }

  document.getElementById('active-table')?.addEventListener('click', handleTableAction);
  document.getElementById('queued-table')?.addEventListener('click', handleTableAction);

  // Modal
  document.getElementById('info-header-btn').onclick = () => {
    document.getElementById('info-modal').style.display = 'flex';
  };
  document.getElementById('close-modal').onclick = () => {
    document.getElementById('info-modal').style.display = 'none';
  };
  document.getElementById('info-modal').onclick = (e) => {
    if (e.target === document.getElementById('info-modal')) {
      document.getElementById('info-modal').style.display = 'none';
    }
  };

  async function refreshAll() {
    await Promise.all([loadActiveProposals(), loadQueuedTable(), loadHistoryTable()]);
  }

  setInterval(() => {
    refreshAll();
    if (W.state.userAddress) C.loadUserTokenData(W.state.userAddress);
  }, CFG.REFRESH_MS);

  await C.loadDAOStats();
  await refreshAll();
})();
