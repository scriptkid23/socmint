/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-page EIP-1193 / EIP-6963 wallet provider. Bundled by
 * `scripts/build-wallet-inpage.mjs` into `inpage-bundle.generated.ts` and
 * injected via `context.addInitScript`.
 *
 * IMPORTANT: this module is an esbuild entrypoint only. It must NOT be imported
 * from the Node graph — it runs as a side-effecting IIFE that touches `window`.
 *
 * cloakbrowser strips Playwright's binding global, so a Node round-trip
 * (exposeFunction) never returns. We therefore sign in-page with viem. The
 * private key lives in the page's JS context — acceptable for burner/test
 * wallets only.
 */
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

declare const window: any;
declare const crypto: { randomUUID?: () => string };

interface ChainCfg {
  chainId: number;
  rpcUrl: string;
  name: string;
}
interface WalletCfg {
  privateKey: string;
  chains: ChainCfg[];
  activeChainId: number;
}

(function install(): void {
  if (window.__cloakWalletInstalled) return;
  const cfg: WalletCfg | undefined = window.__CLOAK_WALLET_CONFIG__;
  if (!cfg || !cfg.privateKey) return;
  window.__cloakWalletInstalled = true;

  const pk = (cfg.privateKey.startsWith('0x') ? cfg.privateKey : `0x${cfg.privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);

  const chains = new Map<number, ChainCfg>();
  for (const c of cfg.chains || []) chains.set(c.chainId, c);
  let activeChainId = cfg.activeChainId;

  const toHex = (n: number) => '0x' + n.toString(16);
  const viemChain = (c: ChainCfg) =>
    defineChain({
      id: c.chainId,
      name: c.name,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [c.rpcUrl] } },
    });

  const listeners: Record<string, Array<(p: any) => void>> = {};
  const emit = (event: string, payload: any) => {
    (listeners[event] || []).forEach((cb) => {
      try {
        cb(payload);
      } catch (_) {
        /* ignore listener errors */
      }
    });
  };

  const log = (...a: any[]) => {
    try {
      console.log('[wallet-page]', ...a);
    } catch (_) {
      /* ignore */
    }
  };

  function rpcError(code: number, message: string): Error {
    const e = new Error(message) as Error & { code: number };
    e.code = code;
    return e;
  }

  function pickSignableMessage(params: any[]): any {
    const [a, b] = params;
    const addr = account.address.toLowerCase();
    const msg = typeof a === 'string' && a.toLowerCase() === addr ? b : a;
    return typeof msg === 'string' && msg.startsWith('0x') ? { raw: msg } : msg;
  }

  function pickTypedData(params: any[]): any {
    const raw = params.find(
      (p) => p && (typeof p === 'object' || (typeof p === 'string' && p.trim().startsWith('{'))),
    );
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async function handle(method: string, params: any[]): Promise<any> {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return toHex(activeChainId);
      case 'net_version':
        return String(activeChainId);
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions':
        return [{ parentCapability: 'eth_accounts', caveats: [] }];
      case 'wallet_revokePermissions':
        return null;
      case 'personal_sign':
      case 'eth_sign':
        return account.signMessage({ message: pickSignableMessage(params) });
      case 'eth_signTypedData_v4':
      case 'eth_signTypedData': {
        const d = pickTypedData(params);
        const types = { ...(d.types || {}) };
        delete types.EIP712Domain;
        return account.signTypedData({
          domain: d.domain,
          types,
          primaryType: d.primaryType,
          message: d.message,
        });
      }
      case 'eth_sendTransaction': {
        const c = chains.get(activeChainId);
        if (!c) throw rpcError(4901, 'no active chain configured');
        const tx = (params[0] || {}) as any;
        const wc = createWalletClient({ account, chain: viemChain(c), transport: http(c.rpcUrl) });
        return wc.sendTransaction({
          account,
          chain: viemChain(c),
          to: tx.to,
          value: tx.value != null ? BigInt(tx.value) : undefined,
          data: tx.data,
          gas: tx.gas != null ? BigInt(tx.gas) : undefined,
        });
      }
      case 'wallet_switchEthereumChain': {
        const id = parseInt((params[0] || {}).chainId, 16);
        if (!chains.has(id)) throw rpcError(4902, 'Unrecognized chain ID');
        activeChainId = id;
        provider.chainId = toHex(id);
        provider.networkVersion = String(id);
        emit('chainChanged', toHex(id));
        return null;
      }
      case 'wallet_addEthereumChain': {
        const p = (params[0] || {}) as any;
        const id = parseInt(p.chainId, 16);
        const rpcUrl = (p.rpcUrls || [])[0];
        if (rpcUrl) chains.set(id, { chainId: id, rpcUrl, name: p.chainName || `chain-${id}` });
        return null;
      }
      default: {
        const c = chains.get(activeChainId);
        if (!c) throw rpcError(4901, 'no active chain configured');
        const pc = createPublicClient({ chain: viemChain(c), transport: http(c.rpcUrl) });
        return pc.request({ method: method as any, params: params as any });
      }
    }
  }

  const provider: any = {
    isMetaMask: true,
    _metamask: { isUnlocked: () => Promise.resolve(true) },
    selectedAddress: account.address,
    chainId: toHex(activeChainId),
    networkVersion: String(activeChainId),
    isConnected: () => true,
    async request(args: { method: string; params?: any[] }) {
      const method = args && args.method;
      const params = (args && args.params) || [];
      log('request', method);
      try {
        const result = await handle(method, params);
        if (method === 'eth_requestAccounts') {
          emit('connect', { chainId: toHex(activeChainId) });
          emit('accountsChanged', [account.address]);
        }
        log('result', method, '-> ok');
        return result;
      } catch (e: any) {
        log('result', method, '-> ERROR', e && e.code, e && e.message);
        throw e;
      }
    },
    on(event: string, cb: (p: any) => void) {
      (listeners[event] = listeners[event] || []).push(cb);
      return provider;
    },
    removeListener(event: string, cb: (p: any) => void) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      return provider;
    },
    enable() {
      return provider.request({ method: 'eth_requestAccounts' });
    },
  };

  try {
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  } catch (_) {
    window.ethereum = provider;
  }
  log('ethereum installed; address=', account.address);

  const uuid = crypto && crypto.randomUUID ? crypto.randomUUID() : '11111111-2222-4333-8444-555555555555';
  const info = {
    uuid,
    name: 'Cloak Wallet',
    icon: "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'32'%20height%3D'32'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'6'%20fill%3D'%23627EEA'%2F%3E%3C%2Fsvg%3E",
    rdns: 'io.cloak.wallet',
  };
  const announce = () =>
    window.dispatchEvent(new window.CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();
