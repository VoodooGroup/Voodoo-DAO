# VoodooDAO Governance

On-chain governance dApp for **Voodoo Token (VDO)** on **PulseChain**.

Propose · Vote · Queue · Execute · Unlock VDO

---

## Live contracts

| Contract | Address |
|----------|---------|
| **DAO** | `0x2CB31523C0a98c223Bd16c774a2F69746519b99C` |
| **VDO** | `0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00` |
| **Faucet** | `0xfB3c2cc7Aea25C176eE9FA1bc08A4B7D639d928B` |

- Network: PulseChain (`chainId` **369** / `0x171`)
- RPC: `https://rpc.pulsechain.com`
- Explorer: [scan.pulsechain.com](https://scan.pulsechain.com)

Related: [VoodooGroup/Faucet](https://github.com/VoodooGroup/Faucet)

---

## Project structure

```
VoodooDAO-Governance/
├── index.html              # UI shell
├── package.json            # npm scripts
├── vercel.json             # Vercel static deploy
├── server.js               # local dev server
├── START.bat               # Windows one-click run
├── LICENSE                 # MIT
├── .gitignore
├── README.md
├── css/
│   └── dao.css             # styles + background
├── js/
│   ├── config.js           # addresses + network
│   ├── helpers.js          # formatting / escape
│   ├── wallet.js           # MetaMask + PulseChain
│   ├── dao.js              # contract read/write
│   └── app.js              # UI tables + events
├── Interaction/
│   ├── DAO.json            # full DAO ABI
│   └── ERC20.json          # VDO ABI
└── assets/
    ├── logo.png
    └── voodoo-token-background.png
```

Same idea as other Voodoo dApps: HTML shell + `js/` modules + `Interaction/` ABIs + static assets.

---

## Features

- Connect wallet + auto-switch / add PulseChain
- VDO balance, locked balance, total locked
- Approve VDO + unlock eligible tokens
- Create normal or whitelist-target proposals
- Vote Yes / No on active proposals
- Queue ended proposals + Execute after timelock
- Proposal history + live DAO parameters
- Info modal (how to move funds)

---

## Local development

```bash
npm start
# → http://localhost:8787
```

Or double-click `START.bat` on Windows.

> Serve over **http** (not `file://`) so `Interaction/*.json` can load via `fetch`.

---

## Deploy to Vercel

1. Push this folder as a **GitHub repo root**
2. Vercel → New Project → import repo
3. Framework: **Other** (static)
4. Build: none / `npm run build`
5. Deploy

`vercel.json` is already configured for a static root deploy.

---

## DAO parameters (on-chain)

| Parameter | Typical value |
|-----------|----------------|
| Voting duration | 3 days |
| Timelock | 2 days |
| Min to propose | 10,000 VDO |
| Quorum | 10% |
| Majority | 51% yes of votes cast |

Exact values load live from the contract.

---

## Encode calldata

Use [abi.hashex.org](https://abi.hashex.org) for transfer / contract calls.  
Native PLS value is not sent by the DAO (value = 0).

---

© 2026 Voodoo Token · MIT License
