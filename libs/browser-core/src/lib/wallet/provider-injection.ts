/** Name of the Playwright-exposed Node function the page shim calls. */
export const WALLET_BINDING_NAME = '__cloakWalletRequest';

/**
 * Build the page init script that installs a MetaMask-like EIP-1193 provider.
 * `address` and `initialChainIdHex` are embedded; all RPC work happens in Node.
 */
export function buildWalletInitScript(address: string, initialChainIdHex: string): string {
  const cfg = JSON.stringify({ address, chainId: initialChainIdHex, binding: WALLET_BINDING_NAME });
  return `(() => {
  const CFG = ${cfg};
  const listeners = {};
  const emit = (event, payload) => {
    (listeners[event] || []).forEach((cb) => { try { cb(payload); } catch (_) {} });
  };
  let chainId = CFG.chainId;
  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: () => Promise.resolve(true) },
    selectedAddress: CFG.address,
    chainId,
    networkVersion: String(parseInt(chainId, 16)),
    async request(args) {
      const method = args && args.method;
      const params = (args && args.params) || [];
      const envelope = await window[CFG.binding]({ method, params });
      if (!envelope || !envelope.ok) {
        const err = new Error((envelope && envelope.error && envelope.error.message) || 'wallet error');
        err.code = (envelope && envelope.error && envelope.error.code) || 4200;
        throw err;
      }
      const result = envelope.result;
      if (method === 'eth_requestAccounts') {
        emit('connect', { chainId });
        emit('accountsChanged', result);
      } else if (method === 'wallet_switchEthereumChain') {
        const next = params[0] && params[0].chainId;
        if (next) { chainId = next; provider.chainId = next; provider.networkVersion = String(parseInt(next, 16)); emit('chainChanged', next); }
      }
      return result;
    },
    on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); return provider; },
    removeListener(event, cb) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== cb); return provider;
    },
    // Legacy sync compatibility shims used by some dapps.
    enable() { return provider.request({ method: 'eth_requestAccounts' }); },
  };
  try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true }); }
  catch (_) { window.ethereum = provider; }

  // EIP-6963 multi-wallet discovery.
  const info = {
    uuid: '00000000-0000-4000-8000-000000000000',
    name: 'MetaMask',
    icon: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    rdns: 'io.metamask',
  };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info, provider }),
  }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();`;
}
