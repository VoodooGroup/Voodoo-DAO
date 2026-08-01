/**
 * Shared formatting / DOM helpers
 */
window.DAO_HELPERS = {
  fmt(n) {
    try {
      return Number(ethers.formatUnits(n || 0n, 18)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return '0.00';
    }
  },

  shortAddr(a) {
    if (!a || a.length < 10) return a || '—';
    return `${a.slice(0, 6)}...${a.slice(-4)}`;
  },

  setLog(msg, isError = false) {
    const el = document.getElementById('error-log');
    if (!el) return;
    el.textContent = msg || '';
    el.className = `text-center mb-8 font-medium min-h-[1.5rem] ${
      isError ? 'text-red-400' : 'text-emerald-300'
    }`;
  },

  errMsg(err) {
    return (
      err?.reason ||
      err?.shortMessage ||
      err?.info?.error?.message ||
      err?.message ||
      'unknown'
    );
  },

  daysFromSeconds(sec) {
    const d = Number(sec) / 86400;
    if (Number.isInteger(d)) return `${d} day${d === 1 ? '' : 's'}`;
    return `${d.toFixed(2)} days`;
  },

  escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  escapeAttr(s) {
    return this.escapeHtml(s).replace(/'/g, '&#39;');
  },

  parseProposal(p) {
    return {
      proposer: p[0],
      target: p[1],
      data: p[2],
      desc: p[3],
      yes: p[4],
      no: p[5],
      endTime: p[6],
      queueTime: p[7],
      executed: p[8],
      canceled: p[9],
      queued: p[10],
    };
  },

  statusOf(p, nowSec) {
    if (p.executed) return 'Executed';
    if (p.canceled) return 'Canceled';
    if (p.queued) return 'Queued';
    if (nowSec < Number(p.endTime)) return 'Active';
    return 'Ended';
  },
};
