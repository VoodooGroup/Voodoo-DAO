/**
 * DAO + VDO contract reads/writes
 */
window.DAO_CONTRACTS = (() => {
  let publicProvider = null;
  let publicDao = null;
  let publicVdo = null;
  let dao = null;
  let vdoToken = null;
  let daoAbi = null;
  let tokenAbi = null;
  let cachedTimelock = 2n * 24n * 60n * 60n;

  async function loadAbis() {
    const { ABI_PATHS } = window.DAO_CONFIG;
    const [daoJson, tokenJson] = await Promise.all([
      fetch(ABI_PATHS.dao).then((r) => r.json()),
      fetch(ABI_PATHS.token).then((r) => r.json()),
    ]);
    daoAbi = daoJson.abi;
    tokenAbi = tokenJson.abi;
    return { daoAbi, tokenAbi };
  }

  function initPublic() {
    const { RPC_URL, DAO_ADDRESS, VDO_ADDRESS } = window.DAO_CONFIG;
    publicProvider = new ethers.JsonRpcProvider(RPC_URL);
    publicDao = new ethers.Contract(DAO_ADDRESS, daoAbi, publicProvider);
    publicVdo = new ethers.Contract(VDO_ADDRESS, tokenAbi, publicProvider);
  }

  function bindSigner(signer) {
    const { DAO_ADDRESS, VDO_ADDRESS } = window.DAO_CONFIG;
    dao = new ethers.Contract(DAO_ADDRESS, daoAbi, signer);
    vdoToken = new ethers.Contract(VDO_ADDRESS, tokenAbi, signer);
  }

  async function loadDAOStats() {
    const H = window.DAO_HELPERS;
    const { DAO_ADDRESS, EXPLORER } = window.DAO_CONFIG;
    const daoLink = document.getElementById('dao-link');
    if (daoLink) {
      daoLink.href = `${EXPLORER}/address/${DAO_ADDRESS}`;
      daoLink.textContent = DAO_ADDRESS;
    }
    try {
      const [paused, voting, timelock, minTok, quorum, majority] = await Promise.all([
        publicDao.paused(),
        publicDao.votingDuration(),
        publicDao.timelockDelay(),
        publicDao.minTokensToPropose(),
        publicDao.quorumPercentage(),
        publicDao.majorityPercentage(),
      ]);
      cachedTimelock = BigInt(timelock);
      const ps = document.getElementById('paused-status');
      if (ps) {
        ps.textContent = paused ? 'Yes' : 'No';
        ps.className = 'font-bold ' + (paused ? 'text-red-400' : 'text-green-400');
      }
      setText('param-voting', H.daysFromSeconds(voting));
      setText('param-timelock', H.daysFromSeconds(timelock));
      setText('param-min', H.fmt(minTok) + ' VDO');
      setText('param-quorum', Number(quorum) + '% of snapshot total supply');
      setText('param-majority', Number(majority) + '% yes of votes cast');
    } catch (e) {
      console.error(e);
      const ps = document.getElementById('paused-status');
      if (ps) {
        ps.textContent = 'Error';
        ps.className = 'font-bold text-red-400';
      }
    }
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  async function fetchAllProposals() {
    const count = Number(await publicDao.getProposalCount());
    if (count === 0) return [];
    const promises = [];
    for (let i = 0; i < count; i++) promises.push(publicDao.getProposal(i));
    const raw = await Promise.all(promises);
    return raw.map((p, i) => ({ id: i, ...window.DAO_HELPERS.parseProposal(p) }));
  }

  async function loadUserTokenData(userAddress) {
    if (!userAddress || !vdoToken || !dao) return;
    const H = window.DAO_HELPERS;
    const { DAO_ADDRESS } = window.DAO_CONFIG;
    try {
      const [bal, locked, totalLocked, allowance] = await Promise.all([
        vdoToken.balanceOf(userAddress),
        dao.getLockedBalance(userAddress),
        dao.getTotalLockedTokens(),
        vdoToken.allowance(userAddress, DAO_ADDRESS),
      ]);
      setText('my-balance', H.fmt(bal));
      setText('my-locked', H.fmt(locked));
      setText('dao-total-locked', H.fmt(totalLocked));
      const approveBtn = document.getElementById('approve-button');
      const unlockBtn = document.getElementById('unlock-all-button');
      if (approveBtn) approveBtn.disabled = !(bal > 0n && allowance < bal);
      if (unlockBtn) unlockBtn.disabled = locked === 0n;
    } catch (e) {
      console.error(e);
    }
  }

  async function approveVDO() {
    const H = window.DAO_HELPERS;
    if (!vdoToken) return H.setLog('Connect wallet first.', true);
    try {
      H.setLog('Approving VDO for DAO...');
      const tx = await vdoToken.approve(window.DAO_CONFIG.DAO_ADDRESS, ethers.MaxUint256);
      H.setLog('Approve sent: ' + tx.hash);
      await tx.wait();
      H.setLog('VDO approved! You can now propose / vote.');
      return true;
    } catch (err) {
      H.setLog('Approve failed: ' + H.errMsg(err), true);
      return false;
    }
  }

  async function unlockAllEligible() {
    const H = window.DAO_HELPERS;
    if (!dao) return H.setLog('Connect wallet first.', true);
    try {
      H.setLog('Checking unlockable proposals...');
      const count = Number(await dao.getProposalCount());
      const now = BigInt(Math.floor(Date.now() / 1000));
      const timelock = BigInt(await dao.timelockDelay());
      let didUnlock = false;
      let attempts = 0;
      for (let i = 0; i < count; i++) {
        const p = H.parseProposal(await dao.getProposal(i));
        const end = BigInt(p.endTime);
        if (p.executed || p.canceled || now > end + timelock) {
          try {
            attempts++;
            H.setLog(`Unlocking tokens for proposal #${i}...`);
            const tx = await dao.withdrawLockedTokens(i);
            await tx.wait();
            didUnlock = true;
          } catch {
            /* not eligible */
          }
        }
      }
      if (didUnlock) {
        H.setLog('Tokens unlocked successfully.');
        return true;
      }
      H.setLog(
        attempts
          ? 'No tokens ready to unlock yet (still locked by active/queued proposals).'
          : 'No tokens ready to unlock yet.',
        true
      );
      return false;
    } catch (err) {
      H.setLog('Unlock failed: ' + H.errMsg(err), true);
      return false;
    }
  }

  async function submitProposal({ type, target, data, desc }) {
    const H = window.DAO_HELPERS;
    if (!dao) throw new Error('Connect wallet first.');
    let tx;
    if (type === 'whitelist') {
      H.setLog('Submitting whitelist proposal...');
      tx = await dao.proposeNewTargetWhitelist(target, desc);
    } else {
      H.setLog('Submitting proposal...');
      tx = await dao.propose(target, data, desc);
    }
    H.setLog('Proposal submitted! Tx: ' + tx.hash);
    await tx.wait();
    H.setLog('Proposal created.');
  }

  async function vote(id, support) {
    const H = window.DAO_HELPERS;
    const addr = await window.DAO_WALLET.state.signer.getAddress();
    const hasVoted = await dao.hasVoted(id, addr);
    if (hasVoted) throw new Error('You have already voted on this proposal.');
    H.setLog(`Voting ${support ? 'YES' : 'NO'} on proposal #${id}...`);
    const tx = await dao.vote(id, support);
    H.setLog('Vote sent: ' + tx.hash);
    await tx.wait();
    H.setLog('Vote successful!');
  }

  async function queue(id) {
    const H = window.DAO_HELPERS;
    H.setLog(`Queueing proposal #${id}...`);
    const tx = await dao.queue(id);
    H.setLog('Queue sent: ' + tx.hash);
    await tx.wait();
    H.setLog('Proposal queued. Wait for timelock before execute.');
  }

  async function execute(id) {
    const H = window.DAO_HELPERS;
    H.setLog(`Executing proposal #${id}...`);
    const tx = await dao.execute(id);
    H.setLog('Execute sent: ' + tx.hash);
    await tx.wait();
    H.setLog('Proposal executed!');
  }

  function getCachedTimelock() {
    return cachedTimelock;
  }

  function getDao() {
    return dao;
  }

  return {
    loadAbis,
    initPublic,
    bindSigner,
    loadDAOStats,
    fetchAllProposals,
    loadUserTokenData,
    approveVDO,
    unlockAllEligible,
    submitProposal,
    vote,
    queue,
    execute,
    getCachedTimelock,
    getDao,
  };
})();
