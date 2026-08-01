/**
 * Network + contract addresses (PulseChain mainnet)
 */
window.DAO_CONFIG = {
  DAO_ADDRESS: '0x2CB31523C0a98c223Bd16c774a2F69746519b99C',
  VDO_ADDRESS: '0x1c5f8e8E84AcC71650F7a627cfA5B24B80f44f00',
  FAUCET_ADDRESS: '0xfB3c2cc7Aea25C176eE9FA1bc08A4B7D639d928B',
  PULSECHAIN_ID: '0x171', // 369
  CHAIN_ID_DEC: 369,
  EXPLORER: 'https://scan.pulsechain.com',
  RPC_URL: 'https://rpc.pulsechain.com',
  CHAIN_NAME: 'PulseChain',
  NATIVE: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  REFRESH_MS: 60000,
  ABI_PATHS: {
    dao: 'Interaction/DAO.json',
    token: 'Interaction/ERC20.json',
  },
};
