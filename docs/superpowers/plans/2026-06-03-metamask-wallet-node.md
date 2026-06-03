# MetaMask Wallet Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `metamask` board node that injects a synthetic EIP-1193 wallet (`window.ethereum`) into the CloakBrowser context, with all signing done in Node via viem, so downstream dApp pages can connect, sign, and send on-chain transactions fully automated and headless.

**Architecture:** A page-side shim forwards every `window.ethereum.request()` over a Playwright `exposeFunction` binding to a Node-side `WalletHandler`, which routes methods to a `WalletSigner` (viem) seam. The node compiles to one `wallet` `FlowStep` → `wallet` `ResolvedFlowStep`, set up once inside `CloakBrowserService.runFlow` so it persists for the rest of the per-profile chain.

**Tech Stack:** TypeScript, Nx monorepo, NestJS (`apps/automation-api`), React + React Flow (`apps/web`), `libs/browser-core` (Playwright/cloakbrowser), `viem` (new), Jest (lib + api), Vitest (web), pnpm.

**Reference spec:** `docs/superpowers/specs/2026-06-03-metamask-wallet-node-design.md`

---

## File Structure

**`libs/browser-core/src/lib/wallet/` (new):**
- `wallet.types.ts` — `WalletChainConfig`, `WalletSigner`, `WalletProviderConfig`, `WalletRpcResult`, error code constants.
- `wallet-handler.ts` — `WalletHandler` (pure routing/validation logic; depends on a `WalletSigner` seam).
- `viem-signer.ts` — `createViemSigner(privateKey)` adapter implementing `WalletSigner` with viem.
- `provider-injection.ts` — `WALLET_BINDING_NAME` + `buildWalletInitScript(...)` (page-side EIP-1193 shim + EIP-6963 announce).

**`libs/browser-core/src/lib/` (modify):**
- `types.ts` — extend `BrowserContextLike`; add `wallet` variants to `ResolvedFlowStep` and `FlowStepResult`.
- `cloak-browser.service.ts` — handle the `wallet` step in `runFlow`.
- `index.ts` (`src/`) — export the new wallet module pieces.

**`apps/automation-api/src/` (modify):**
- `runs/run.types.ts` — `wallet` variant in `FlowStep`; `'wallet'` in `FlowStepRecord.type`.
- `boards/board.types.ts` — `MetaMaskNodeData` + `ChainConfig`; `metamask` variant in `BoardNode`.
- `boards/node-registry.ts` — `metamask.toSteps`.
- `runs/run.service.ts` — map `wallet` `FlowStep` → `ResolvedFlowStep`.

**`apps/web/src/` (modify + new):**
- `api/client.ts` — `ChainConfig`, `MetaMaskNodeData`; extend `BoardNodeData` + `BoardNode.type`.
- `components/automation/nodes/metamask-node.tsx` (new) — node UI.
- `components/automation/nodes/registry.ts` — `metamask` descriptor + `NODE_ORDER` + `NodeType`.

---

## Task 1: Add viem dependency

**Files:**
- Modify: `package.json` (root, via pnpm)

- [ ] **Step 1: Install viem**

Run: `pnpm add viem`
Expected: `viem` appears under `dependencies` in `package.json`, install succeeds.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('viem/package.json') && console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add viem dependency for wallet node"
```

---

## Task 2: browser-core wallet types

**Files:**
- Create: `libs/browser-core/src/lib/wallet/wallet.types.ts`

- [ ] **Step 1: Write the types file**

```ts
/** A configured EVM chain the synthetic wallet can use. */
export interface WalletChainConfig {
  chainId: number;
  rpcUrl: string;
  name: string;
}

/** Config the wallet provider is built from (private key never leaves Node). */
export interface WalletProviderConfig {
  privateKey: string;
  chains: WalletChainConfig[];
  activeChainId: number;
}

/** Parsed EIP-712 typed-data payload (eth_signTypedData_v4). */
export interface TypedData {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Node-side signing seam. The default impl wraps viem; tests inject a fake.
 * Holds the account; chain selection is passed per-call by the handler.
 */
export interface WalletSigner {
  /** 0x-prefixed checksum address derived from the private key. */
  readonly address: string;
  /** personal_sign — `message` is a 0x-hex string of the raw bytes. */
  signMessage(message: string): Promise<string>;
  /** eth_signTypedData_v4 — already-parsed typed data. */
  signTypedData(data: TypedData): Promise<string>;
  /** eth_sendTransaction — build + sign + broadcast via the active chain RPC; returns tx hash. */
  sendTransaction(rpcUrl: string, chainId: number, tx: Record<string, unknown>): Promise<string>;
  /** Read passthrough — forward a raw JSON-RPC call to the active chain RPC. */
  rpcRequest(rpcUrl: string, method: string, params: unknown[]): Promise<unknown>;
}

/** EIP-1193 error returned to the page when a request cannot be served. */
export class WalletRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'WalletRpcError';
  }
}

/** Envelope returned over the exposeFunction binding (avoids relying on error marshalling). */
export type WalletRpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: number; message: string } };

export const WALLET_ERR_UNSUPPORTED = 4200;
export const WALLET_ERR_UNKNOWN_CHAIN = 4902;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p libs/browser-core/tsconfig.lib.json`
Expected: no errors referencing `wallet.types.ts`.

- [ ] **Step 3: Commit**

```bash
git add libs/browser-core/src/lib/wallet/wallet.types.ts
git commit -m "feat(browser-core): wallet provider types and signer seam"
```

---

## Task 3: WalletHandler (routing + validation)

**Files:**
- Create: `libs/browser-core/src/lib/wallet/wallet-handler.ts`
- Test: `libs/browser-core/src/lib/wallet/wallet-handler.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { WalletHandler } from './wallet-handler';
import type { WalletSigner, TypedData } from './wallet.types';

function fakeSigner(overrides: Partial<WalletSigner> = {}): WalletSigner & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    address: '0xAbC0000000000000000000000000000000000001',
    async signMessage(message) {
      calls.push(`signMessage:${message}`);
      return '0xsig';
    },
    async signTypedData(data: TypedData) {
      calls.push(`signTypedData:${data.primaryType}`);
      return '0xtyped';
    },
    async sendTransaction(rpcUrl, chainId, tx) {
      calls.push(`send:${rpcUrl}:${chainId}:${(tx as { to?: string }).to}`);
      return '0xhash';
    },
    async rpcRequest(rpcUrl, method, params) {
      calls.push(`rpc:${rpcUrl}:${method}:${JSON.stringify(params)}`);
      return '0xbalance';
    },
    ...overrides,
  };
}

const chains = [
  { chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' },
  { chainId: 137, rpcUrl: 'https://poly.example', name: 'Polygon' },
];

function build(signer = fakeSigner()) {
  return new WalletHandler({ privateKey: '0x00', chains, activeChainId: 1 }, signer);
}

describe('WalletHandler', () => {
  it('returns the address for eth_requestAccounts and eth_accounts', async () => {
    const h = build();
    expect(await h.handle({ method: 'eth_requestAccounts', params: [] })).toEqual([
      '0xAbC0000000000000000000000000000000000001',
    ]);
    expect(await h.handle({ method: 'eth_accounts', params: [] })).toEqual([
      '0xAbC0000000000000000000000000000000000001',
    ]);
  });

  it('returns active chain id as hex / decimal', async () => {
    const h = build();
    expect(await h.handle({ method: 'eth_chainId', params: [] })).toBe('0x1');
    expect(await h.handle({ method: 'net_version', params: [] })).toBe('1');
  });

  it('routes personal_sign to the signer with the message arg', async () => {
    const signer = fakeSigner();
    const h = build(signer);
    const sig = await h.handle({ method: 'personal_sign', params: ['0xdeadbeef', signer.address] });
    expect(sig).toBe('0xsig');
    expect(signer.calls).toContain('signMessage:0xdeadbeef');
  });

  it('parses and routes eth_signTypedData_v4', async () => {
    const signer = fakeSigner();
    const h = build(signer);
    const typed = JSON.stringify({ domain: {}, types: { Foo: [] }, primaryType: 'Foo', message: {} });
    const sig = await h.handle({ method: 'eth_signTypedData_v4', params: [signer.address, typed] });
    expect(sig).toBe('0xtyped');
    expect(signer.calls).toContain('signTypedData:Foo');
  });

  it('sends a transaction via the active chain rpc', async () => {
    const signer = fakeSigner();
    const h = build(signer);
    const hash = await h.handle({
      method: 'eth_sendTransaction',
      params: [{ to: '0xdead', value: '0x1' }],
    });
    expect(hash).toBe('0xhash');
    expect(signer.calls).toContain('send:https://eth.example:1:0xdead');
  });

  it('switches to a known chain and reflects it in eth_chainId', async () => {
    const h = build();
    expect(await h.handle({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] })).toBeNull();
    expect(await h.handle({ method: 'eth_chainId', params: [] })).toBe('0x89');
  });

  it('rejects switching to an unknown chain with code 4902', async () => {
    const h = build();
    await expect(
      h.handle({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x999' }] }),
    ).rejects.toMatchObject({ code: 4902 });
  });

  it('adds a chain then can switch to it', async () => {
    const h = build();
    await h.handle({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0xa', chainName: 'Optimism', rpcUrls: ['https://op.example'] }],
    });
    expect(await h.handle({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa' }] })).toBeNull();
    expect(await h.handle({ method: 'eth_chainId', params: [] })).toBe('0xa');
  });

  it('passes unknown read methods through to the active rpc', async () => {
    const signer = fakeSigner();
    const h = build(signer);
    const res = await h.handle({ method: 'eth_getBalance', params: ['0xabc', 'latest'] });
    expect(res).toBe('0xbalance');
    expect(signer.calls).toContain('rpc:https://eth.example:eth_getBalance:["0xabc","latest"]');
  });

  it('rejects truly unsupported methods with code 4200', async () => {
    const h = build();
    await expect(h.handle({ method: 'eth_sign', params: [] })).rejects.toMatchObject({ code: 4200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test browser-core --testPathPattern=wallet-handler`
Expected: FAIL — cannot find module `./wallet-handler`.

- [ ] **Step 3: Write minimal implementation**

```ts
import {
  WALLET_ERR_UNKNOWN_CHAIN,
  WALLET_ERR_UNSUPPORTED,
  WalletRpcError,
  type TypedData,
  type WalletChainConfig,
  type WalletProviderConfig,
  type WalletSigner,
} from './wallet.types';

export interface WalletRequest {
  method: string;
  params?: unknown[];
}

const READ_PASSTHROUGH = new Set([
  'eth_call',
  'eth_estimateGas',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_feeHistory',
  'eth_maxPriorityFeePerGas',
  'eth_getLogs',
]);

function toHex(n: number): string {
  return '0x' + n.toString(16);
}

function parseChainId(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
  throw new WalletRpcError(WALLET_ERR_UNSUPPORTED, `Invalid chainId: ${String(value)}`);
}

/** Pure EIP-1193 method router. Holds the active chain; delegates crypto/IO to a WalletSigner. */
export class WalletHandler {
  private readonly chains = new Map<number, WalletChainConfig>();
  private activeChainId: number;

  constructor(
    config: WalletProviderConfig,
    private readonly signer: WalletSigner,
  ) {
    for (const c of config.chains) this.chains.set(c.chainId, c);
    this.activeChainId = config.activeChainId;
  }

  get address(): string {
    return this.signer.address;
  }

  get activeChainIdHex(): string {
    return toHex(this.activeChainId);
  }

  private activeChain(): WalletChainConfig {
    const chain = this.chains.get(this.activeChainId);
    if (!chain) throw new WalletRpcError(WALLET_ERR_UNKNOWN_CHAIN, `No active chain ${this.activeChainId}`);
    return chain;
  }

  async handle(req: WalletRequest): Promise<unknown> {
    const params = req.params ?? [];
    switch (req.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [this.signer.address];
      case 'eth_chainId':
        return toHex(this.activeChainId);
      case 'net_version':
        return String(this.activeChainId);
      case 'personal_sign': {
        const message = params[0] as string;
        return this.signer.signMessage(message);
      }
      case 'eth_signTypedData_v4': {
        const raw = params[1];
        const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TypedData;
        return this.signer.signTypedData(data);
      }
      case 'eth_sendTransaction': {
        const tx = (params[0] ?? {}) as Record<string, unknown>;
        const chain = this.activeChain();
        return this.signer.sendTransaction(chain.rpcUrl, chain.chainId, tx);
      }
      case 'wallet_switchEthereumChain': {
        const target = parseChainId((params[0] as { chainId?: unknown })?.chainId);
        if (!this.chains.has(target)) {
          throw new WalletRpcError(WALLET_ERR_UNKNOWN_CHAIN, `Unknown chain ${target}`);
        }
        this.activeChainId = target;
        return null;
      }
      case 'wallet_addEthereumChain': {
        const p = (params[0] ?? {}) as { chainId?: unknown; chainName?: string; rpcUrls?: string[] };
        const chainId = parseChainId(p.chainId);
        const rpcUrl = p.rpcUrls?.[0];
        if (!rpcUrl) throw new WalletRpcError(WALLET_ERR_UNSUPPORTED, 'addEthereumChain requires an rpcUrl');
        this.chains.set(chainId, { chainId, rpcUrl, name: p.chainName ?? `chain-${chainId}` });
        return null;
      }
      default: {
        if (READ_PASSTHROUGH.has(req.method)) {
          const chain = this.activeChain();
          return this.signer.rpcRequest(chain.rpcUrl, req.method, params);
        }
        throw new WalletRpcError(WALLET_ERR_UNSUPPORTED, `Unsupported method: ${req.method}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test browser-core --testPathPattern=wallet-handler`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/wallet/wallet-handler.ts libs/browser-core/src/lib/wallet/wallet-handler.spec.ts
git commit -m "feat(browser-core): EIP-1193 wallet request router"
```

---

## Task 4: viem signer adapter

**Files:**
- Create: `libs/browser-core/src/lib/wallet/viem-signer.ts`
- Test: `libs/browser-core/src/lib/wallet/viem-signer.spec.ts`

- [ ] **Step 1: Write the failing test** (pure, no network: address derivation + message signing)

```ts
import { createViemSigner } from './viem-signer';

// Well-known Hardhat account #0 private key (test only — never holds real funds).
const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('createViemSigner', () => {
  it('derives the correct checksum address from the private key', () => {
    const signer = createViemSigner(TEST_PK);
    expect(signer.address).toBe(TEST_ADDR);
  });

  it('signs a personal_sign message to a 65-byte signature', async () => {
    const signer = createViemSigner(TEST_PK);
    // hex for "hello"
    const sig = await signer.signMessage('0x68656c6c6f');
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test browser-core --testPathPattern=viem-signer`
Expected: FAIL — cannot find module `./viem-signer`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { TypedData, WalletSigner } from './wallet.types';

function minimalChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

function toBigInt(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return undefined;
}

/** viem-backed WalletSigner. The private key stays in this process. */
export function createViemSigner(privateKey: string): WalletSigner {
  const account = privateKeyToAccount(privateKey as Hex);

  return {
    address: account.address,

    async signMessage(message: string): Promise<string> {
      return account.signMessage({ message: { raw: message as Hex } });
    },

    async signTypedData(data: TypedData): Promise<string> {
      const types = { ...data.types };
      delete (types as Record<string, unknown>)['EIP712Domain'];
      return account.signTypedData({
        domain: data.domain,
        types: types as never,
        primaryType: data.primaryType as never,
        message: data.message as never,
      });
    },

    async sendTransaction(rpcUrl, chainId, tx): Promise<string> {
      const chain = minimalChain(chainId, rpcUrl);
      const client = createWalletClient({ account, chain, transport: http(rpcUrl) });
      return client.sendTransaction({
        account,
        chain,
        to: tx['to'] as Hex | undefined,
        value: toBigInt(tx['value']),
        data: tx['data'] as Hex | undefined,
        gas: toBigInt(tx['gas']),
      });
    },

    async rpcRequest(rpcUrl, method, params): Promise<unknown> {
      const client = createPublicClient({ transport: http(rpcUrl) });
      return client.request({ method: method as never, params: params as never });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test browser-core --testPathPattern=viem-signer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/wallet/viem-signer.ts libs/browser-core/src/lib/wallet/viem-signer.spec.ts
git commit -m "feat(browser-core): viem-backed wallet signer"
```

---

## Task 5: Page-side provider injection script

**Files:**
- Create: `libs/browser-core/src/lib/wallet/provider-injection.ts`
- Test: `libs/browser-core/src/lib/wallet/provider-injection.spec.ts`

The init script runs in the page. It defines `window.ethereum`, forwards `request()` to the Node binding (`window[WALLET_BINDING_NAME]`), unwraps the `{ ok, result|error }` envelope, emits events for connect/switch, and announces via EIP-6963. The builder embeds the binding name, address, and initial chain-id hex as JSON literals.

- [ ] **Step 1: Write the failing test** (assert the built script embeds the constants and key hooks)

```ts
import { WALLET_BINDING_NAME, buildWalletInitScript } from './provider-injection';

describe('buildWalletInitScript', () => {
  const script = buildWalletInitScript('0xAbc0000000000000000000000000000000000001', '0x1');

  it('embeds the binding name and address/chain', () => {
    expect(script).toContain(WALLET_BINDING_NAME);
    expect(script).toContain('0xAbc0000000000000000000000000000000000001');
    expect(script).toContain('"0x1"');
  });

  it('defines window.ethereum, isMetaMask, and EIP-6963 announce', () => {
    expect(script).toContain('window.ethereum');
    expect(script).toContain('isMetaMask');
    expect(script).toContain('eip6963:announceProvider');
  });

  it('unwraps the envelope and rethrows provider errors with a code', () => {
    expect(script).toContain('.ok');
    expect(script).toContain('.code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test browser-core --testPathPattern=provider-injection`
Expected: FAIL — cannot find module `./provider-injection`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test browser-core --testPathPattern=provider-injection`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/wallet/provider-injection.ts libs/browser-core/src/lib/wallet/provider-injection.spec.ts
git commit -m "feat(browser-core): EIP-1193 page injection script"
```

---

## Task 6: Extend BrowserContextLike + flow-step types

**Files:**
- Modify: `libs/browser-core/src/lib/types.ts`

- [ ] **Step 1: Extend `BrowserContextLike`**

Add `addInitScript` and `exposeFunction` to the interface (lines 42-47 area):

```ts
export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  pages(): PageLike[];
  on(event: 'close', listener: () => void): void;
  close(): Promise<void>;
  /** Register a script run on every new document (Playwright BrowserContext.addInitScript). */
  addInitScript(script: string): Promise<void>;
  /** Expose a Node function callable from the page as window[name] (Playwright exposeFunction). */
  exposeFunction(name: string, callback: (arg: unknown) => unknown): Promise<void>;
}
```

- [ ] **Step 2: Add `wallet` to `ResolvedFlowStep`**

Replace the `ResolvedFlowStep` union (lines 70-74) with:

```ts
export type ResolvedFlowStep =
  | { type: 'goto'; url: string; waitUntil?: WaitUntil; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'agent'; task: AgentTask; limits: AgentLimits; transcriptPath?: string }
  | { type: 'screenshot'; screenshotPath: string }
  | { type: 'wallet'; privateKey: string; chains: WalletChainConfig[]; activeChainId: number };
```

Add the import at the top of `types.ts`:

```ts
import type { WalletChainConfig } from './wallet/wallet.types';
```

- [ ] **Step 3: Add `wallet` to `FlowStepResult`**

Append a new member to the `FlowStepResult` union (after the screenshot member, lines 98-117):

```ts
  | {
      type: 'wallet';
      status: 'completed' | 'failed';
      error: null | string;
    };
```

- [ ] **Step 4: Typecheck (existing fakes already stub `addInitScript`/`exposeBinding`)**

Run: `npx nx test browser-core --testPathPattern=cloak-browser.service`
Expected: The existing fake context in `cloak-browser.service.spec.ts` casts with `as BrowserContextLike` and already includes `addInitScript`; it lacks `exposeFunction`. Because those fakes use `as BrowserContextLike`, compilation still passes. Tests PASS (existing behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add libs/browser-core/src/lib/types.ts
git commit -m "feat(browser-core): wallet flow-step + context init/expose seams"
```

---

## Task 7: Handle the wallet step in runFlow

**Files:**
- Modify: `libs/browser-core/src/lib/cloak-browser.service.ts`
- Test: `libs/browser-core/src/lib/cloak-browser.service.spec.ts`

- [ ] **Step 1: Write the failing test** (append inside the `describe('CloakBrowserService.runFlow', ...)` block)

```ts
  it('sets up the wallet provider via exposeFunction + addInitScript', async () => {
    const exposed: Record<string, (arg: unknown) => unknown> = {};
    const initScripts: string[] = [];
    const page = {
      async goto() {},
      async title() { return 'T'; },
      url() { return 'https://dapp.example/'; },
      async screenshot() {},
      on() {},
    } as unknown as PageLike;
    const context: BrowserContextLike = {
      async newPage() { return page; },
      pages() { return [page]; },
      on() {},
      async close() {},
      async addInitScript(s: string) { initScripts.push(s); },
      async exposeFunction(name: string, cb: (arg: unknown) => unknown) { exposed[name] = cb; },
    };
    const launcher: BrowserLauncher = {
      async ensureBinary() {},
      async launchPersistentContext() { return context; },
    };
    const svc = new CloakBrowserService(launcher);

    const { results } = await svc.runFlow(launch, [
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);

    expect(results[0]).toMatchObject({ type: 'wallet', status: 'completed', error: null });
    expect(Object.keys(exposed)).toContain('__cloakWalletRequest');
    expect(initScripts).toHaveLength(1);

    // The exposed binding routes through the handler and returns the address envelope.
    const envelope = (await exposed['__cloakWalletRequest']({
      method: 'eth_requestAccounts',
      params: [],
    })) as { ok: boolean; result: string[] };
    expect(envelope.ok).toBe(true);
    expect(envelope.result[0]).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test browser-core --testPathPattern=cloak-browser.service`
Expected: FAIL — `wallet` step falls into the screenshot `else` branch / `addInitScript` not called.

- [ ] **Step 3: Implement the wallet branch**

Add imports near the top of `cloak-browser.service.ts`:

```ts
import { WalletHandler } from './wallet/wallet-handler';
import { createViemSigner } from './wallet/viem-signer';
import { buildWalletInitScript, WALLET_BINDING_NAME } from './wallet/provider-injection';
import type { WalletRpcResult } from './wallet/wallet.types';
```

Inside `runFlow`'s `for (const step of steps)` loop, add a branch **before** the final `else` (the screenshot branch). The current chain is `if goto … else if wait … else if agent … else (screenshot)`. Change the final `else` to `else if (step.type === 'screenshot')` and add:

```ts
          } else if (step.type === 'wallet') {
            const signer = createViemSigner(step.privateKey);
            const handler = new WalletHandler(
              { privateKey: step.privateKey, chains: step.chains, activeChainId: step.activeChainId },
              signer,
            );
            await context.exposeFunction(
              WALLET_BINDING_NAME,
              async (arg: unknown): Promise<WalletRpcResult> => {
                const { method, params } = (arg ?? {}) as { method: string; params?: unknown[] };
                try {
                  return { ok: true, result: await handler.handle({ method, params }) };
                } catch (e) {
                  const code = (e as { code?: number }).code ?? 4200;
                  return { ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } };
                }
              },
            );
            await context.addInitScript(
              buildWalletInitScript(handler.address, handler.activeChainIdHex),
            );
            results.push({ type: 'wallet', status: 'completed', error: null });
```

Then in the `catch (err)` block at the end of the loop body, add a `wallet` arm alongside the others (before the screenshot fallback):

```ts
          } else if (step.type === 'wallet') {
            results.push({ type: 'wallet', ...base });
```

(Adjust the trailing `else` for screenshot so the chain reads `… else if (step.type === 'screenshot') { results.push({ type: 'screenshot', ...base, screenshotPath: null }); }`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test browser-core --testPathPattern=cloak-browser.service`
Expected: PASS (all prior runFlow tests + the new wallet test).

- [ ] **Step 5: Export wallet module from the lib entrypoint**

In `libs/browser-core/src/index.ts` append:

```ts
export * from './lib/wallet/wallet.types';
export { WalletHandler } from './lib/wallet/wallet-handler';
export { createViemSigner } from './lib/wallet/viem-signer';
export { buildWalletInitScript, WALLET_BINDING_NAME } from './lib/wallet/provider-injection';
```

- [ ] **Step 6: Commit**

```bash
git add libs/browser-core/src/lib/cloak-browser.service.ts libs/browser-core/src/lib/cloak-browser.service.spec.ts libs/browser-core/src/index.ts
git commit -m "feat(browser-core): wire wallet provider setup into runFlow"
```

---

## Task 8: Backend flow-step + board node types

**Files:**
- Modify: `apps/automation-api/src/runs/run.types.ts`
- Modify: `apps/automation-api/src/boards/board.types.ts`

- [ ] **Step 1: Add the `wallet` `FlowStep`**

In `run.types.ts`, add to the `FlowStep` union (after the `agent` member, before `screenshot`):

```ts
  | {
      type: 'wallet';
      privateKey: string;
      chains: { chainId: number; rpcUrl: string; name: string }[];
      activeChainId: number;
    }
```

And widen `FlowStepRecord.type`:

```ts
  type: 'goto' | 'wait' | 'agent' | 'screenshot' | 'wallet';
```

- [ ] **Step 2: Add board node types**

In `board.types.ts`, add before `BoardNode`:

```ts
export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  name: string;
}
export interface MetaMaskNodeData {
  privateKey: string;
  chains: ChainConfig[];
  activeChainId: number;
}
```

Add the variant to the `BoardNode` union:

```ts
  | (NodeBase & { type: 'metamask'; data: MetaMaskNodeData })
```

- [ ] **Step 3: Typecheck (registry will now fail to compile — expected, fixed in Task 9)**

Run: `npx tsc --noEmit -p apps/automation-api/tsconfig.app.json`
Expected: error in `node-registry.ts` — `metamask` missing from `ChainRegistry` (the mapped type forces it). This is the intended compile gate; Task 9 resolves it.

- [ ] **Step 4: Commit**

```bash
git add apps/automation-api/src/runs/run.types.ts apps/automation-api/src/boards/board.types.ts
git commit -m "feat(automation-api): wallet flow-step + metamask board node types"
```

---

## Task 9: Backend node-registry compile

**Files:**
- Modify: `apps/automation-api/src/boards/node-registry.ts`
- Test: `apps/automation-api/src/boards/resolve-chains.spec.ts`

- [ ] **Step 1: Write the failing test** (append a case in `resolve-chains.spec.ts`)

```ts
  it('compiles a metamask node into a single wallet step', () => {
    const graph = {
      nodes: [
        { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: 'prof-1' } },
        {
          id: 'm',
          type: 'metamask',
          position: { x: 0, y: 0 },
          data: {
            privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
            activeChainId: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'm' }],
    } as never;

    const jobs = resolveChains(graph);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].steps).toEqual([
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);
  });

  it('throws when the metamask private key is malformed', () => {
    const graph = {
      nodes: [
        { id: 'p', type: 'profile', position: { x: 0, y: 0 }, data: { profileId: 'prof-1' } },
        {
          id: 'm',
          type: 'metamask',
          position: { x: 0, y: 0 },
          data: { privateKey: 'nope', chains: [{ chainId: 1, rpcUrl: 'https://x', name: 'X' }], activeChainId: 1 },
        },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'm' }],
    } as never;
    expect(() => resolveChains(graph)).toThrow(/private key/i);
  });
```

(Ensure `resolveChains` is imported at the top of the spec — it already is for existing tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test automation-api --testPathPattern=resolve-chains`
Expected: FAIL — `metamask` not handled / `toSteps` undefined, plus the pre-existing compile error from Task 8.

- [ ] **Step 3: Implement `metamask.toSteps`**

In `node-registry.ts`, add a `metamask` descriptor to `NODE_CHAIN_REGISTRY` (after `record`):

```ts
  metamask: {
    toSteps(node) {
      const d = node.data;
      if (!/^0x[0-9a-fA-F]{64}$/.test(d.privateKey ?? '')) {
        throw new BoardGraphError(`MetaMask node ${node.id} has an invalid private key`);
      }
      if (!d.chains?.length) {
        throw new BoardGraphError(`MetaMask node ${node.id} has no chains`);
      }
      for (const c of d.chains) {
        if (!Number.isInteger(c.chainId) || c.chainId <= 0) {
          throw new BoardGraphError(`MetaMask node ${node.id} has an invalid chainId`);
        }
        if (!c.rpcUrl?.trim()) {
          throw new BoardGraphError(`MetaMask node ${node.id} has a chain with no rpcUrl`);
        }
      }
      if (!d.chains.some((c) => c.chainId === d.activeChainId)) {
        throw new BoardGraphError(`MetaMask node ${node.id} activeChainId is not in its chains`);
      }
      return {
        steps: [
          {
            type: 'wallet',
            privateKey: d.privateKey,
            chains: d.chains.map((c) => ({ chainId: c.chainId, rpcUrl: c.rpcUrl, name: c.name })),
            activeChainId: d.activeChainId,
          },
        ],
      };
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test automation-api --testPathPattern=resolve-chains`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/boards/node-registry.ts apps/automation-api/src/boards/resolve-chains.spec.ts
git commit -m "feat(automation-api): compile metamask node to wallet step"
```

---

## Task 10: Map wallet FlowStep in RunService

**Files:**
- Modify: `apps/automation-api/src/runs/run.service.ts`
- Test: `apps/automation-api/src/runs/run.service.spec.ts`

- [ ] **Step 1: Write the failing test**

First inspect the existing spec to copy its harness style: `Read apps/automation-api/src/runs/run.service.spec.ts`. Then add a test asserting a `wallet` `FlowStep` is forwarded unchanged to `runFlow`. Use the spec's existing fake browser (it records the `resolved` steps it receives). Concretely add:

```ts
  it('forwards a wallet step to runFlow unchanged', async () => {
    // `browser` is the spec's fake CloakBrowserService capturing the resolved steps.
    await service.executeFlow('prof-1', [
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);
    expect(browser.lastSteps).toEqual([
      {
        type: 'wallet',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        chains: [{ chainId: 1, rpcUrl: 'https://eth.example', name: 'Ethereum' }],
        activeChainId: 1,
      },
    ]);
  });
```

> If the fake in `run.service.spec.ts` does not already expose the captured steps, add a `lastSteps` field to it (mirror the existing fake's pattern — see `apps/automation-api/src/test/cloakbrowser.mock.ts`). Match whatever assertion shape the existing flow tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test automation-api --testPathPattern=run.service`
Expected: FAIL — `wallet` step is not mapped; it hits the final `return { type: 'goto', ... }` fallback and produces a malformed step.

- [ ] **Step 3: Implement the mapping**

In `run.service.ts`, inside `executeFlow`'s `steps.map((step, i) => { … })`, add before the final `return { type: 'goto', ... }`:

```ts
      if (step.type === 'wallet') {
        return {
          type: 'wallet',
          privateKey: step.privateKey,
          chains: step.chains,
          activeChainId: step.activeChainId,
        };
      }
```

Also extend the `stepRecords` mapping (the `stepResults.map`) so a `wallet` result serializes cleanly — the generic branch already returns `{ type, status, error, … }`, and `title`/`finalUrl`/`screenshot` are `undefined` for `wallet`, which is correct. No change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test automation-api --testPathPattern=run.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/automation-api/src/runs/run.service.ts apps/automation-api/src/runs/run.service.spec.ts
git commit -m "feat(automation-api): map wallet step in executeFlow"
```

---

## Task 11: Frontend shared types

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add the types**

Before `BoardNodeData` (line 61), add:

```ts
export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  name: string;
}
export interface MetaMaskNodeData {
  privateKey: string;
  chains: ChainConfig[];
  activeChainId: number;
}
```

Add `MetaMaskNodeData` to the `BoardNodeData` union:

```ts
export type BoardNodeData =
  | ProfileNodeData
  | GotoNodeData
  | WaitNodeData
  | AgentNodeData
  | RecordNodeData
  | MetaMaskNodeData
  | Record<string, never>;
```

Add `'metamask'` to `BoardNode.type`:

```ts
  type: 'profile' | 'goto' | 'wait' | 'agent' | 'screenshot' | 'record' | 'metamask';
```

- [ ] **Step 2: Typecheck**

Run: `npx nx typecheck web` (or `npx tsc --noEmit -p apps/web/tsconfig.app.json`)
Expected: a NEW error in `registry.ts` — `metamask` missing from the `NodeRegistry` mapped type. Intended gate, fixed in Task 13.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "feat(web): metamask node shared types"
```

---

## Task 12: Frontend MetaMask node component

**Files:**
- Create: `apps/web/src/components/automation/nodes/metamask-node.tsx`

- [ ] **Step 1: Write the component**

Mirrors `agent-node.tsx` styling (brutalist mono UI). Masked key, editable chain rows, active-chain `<select>`, derived address preview via viem, and a burner-wallet warning.

```tsx
import { useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainConfig } from '../../../api/client';

export interface MetaMaskNodeProps extends NodeProps {
  data: {
    privateKey: string;
    chains: ChainConfig[];
    activeChainId: number;
    onChange?: (patch: Record<string, unknown>) => void;
  };
}

function deriveAddress(privateKey: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) return null;
  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    return null;
  }
}

export function MetaMaskNode({ data }: MetaMaskNodeProps) {
  const patch = (p: Record<string, unknown>) => data.onChange?.(p);
  const chains = data.chains ?? [];
  const address = useMemo(() => deriveAddress(data.privateKey ?? ''), [data.privateKey]);

  const updateChain = (idx: number, field: keyof ChainConfig, value: string) => {
    const next = chains.map((c, i) =>
      i === idx
        ? { ...c, [field]: field === 'chainId' ? Number(value) : value }
        : c,
    );
    patch({ chains: next });
  };

  const addChain = () =>
    patch({ chains: [...chains, { chainId: 1, rpcUrl: '', name: '' }] });

  const removeChain = (idx: number) => {
    const next = chains.filter((_, i) => i !== idx);
    const patchObj: Record<string, unknown> = { chains: next };
    if (!next.some((c) => c.chainId === data.activeChainId) && next[0]) {
      patchObj.activeChainId = next[0].chainId;
    }
    patch(patchObj);
  };

  return (
    <div className="min-w-64 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        MetaMask
      </div>
      <div className="space-y-2 p-2">
        <input
          type="password"
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="Private key (0x…, 64 hex)"
          value={data.privateKey ?? ''}
          onChange={(e) => patch({ privateKey: e.target.value.trim() })}
        />
        <div className="font-mono text-[10px] text-foreground/70 break-all">
          {address ? `addr: ${address}` : 'addr: —'}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-wide text-foreground/60">
          Burner / test wallets only — key is stored in plain text.
        </div>

        <div className="space-y-1">
          {chains.map((c, idx) => (
            <div key={idx} className="border border-foreground/40 p-1 space-y-1">
              <div className="flex gap-1">
                <input
                  className="w-16 border-2 border-foreground bg-background px-1 py-0.5 font-mono text-[10px]"
                  placeholder="id"
                  value={Number.isFinite(c.chainId) ? c.chainId : ''}
                  onChange={(e) => updateChain(idx, 'chainId', e.target.value)}
                />
                <input
                  className="flex-1 border-2 border-foreground bg-background px-1 py-0.5 font-mono text-[10px]"
                  placeholder="name"
                  value={c.name}
                  onChange={(e) => updateChain(idx, 'name', e.target.value)}
                />
                <button
                  className="border-2 border-foreground px-1 font-mono text-[10px]"
                  onClick={() => removeChain(idx)}
                >
                  x
                </button>
              </div>
              <input
                className="w-full border-2 border-foreground bg-background px-1 py-0.5 font-mono text-[10px]"
                placeholder="rpc url"
                value={c.rpcUrl}
                onChange={(e) => updateChain(idx, 'rpcUrl', e.target.value)}
              />
            </div>
          ))}
          <button
            className="w-full border-2 border-foreground px-2 py-1 font-mono text-[10px] uppercase tracking-widest"
            onClick={addChain}
          >
            + chain
          </button>
        </div>

        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] uppercase"
          value={data.activeChainId}
          onChange={(e) => patch({ activeChainId: Number(e.target.value) })}
        >
          {chains.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.name || `chain ${c.chainId}`}
            </option>
          ))}
        </select>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx nx typecheck web`
Expected: no errors in `metamask-node.tsx` (registry error from Task 11 still present until Task 13).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/automation/nodes/metamask-node.tsx
git commit -m "feat(web): MetaMask node component"
```

---

## Task 13: Register the node in the frontend registry

**Files:**
- Modify: `apps/web/src/components/automation/nodes/registry.ts`

- [ ] **Step 1: Add imports**

At the top with the other node imports:

```ts
import { MetaMaskNode } from './metamask-node';
```

And extend the type import from `../../../api/client` to include `MetaMaskNodeData` and `ChainConfig`:

```ts
  type MetaMaskNodeData,
  type ChainConfig,
```

- [ ] **Step 2: Add a default chain constant**

Near `DEFAULT_WAIT_MS` (line 22):

```ts
const DEFAULT_METAMASK_CHAINS: ChainConfig[] = [
  { chainId: 1, rpcUrl: 'https://eth.llamarpc.com', name: 'Ethereum' },
];
```

- [ ] **Step 3: Add the `metamask` descriptor to `NODE_DESCRIPTORS`**

After the `record` descriptor:

```ts
  metamask: {
    label: 'MetaMask',
    component: MetaMaskNode,
    defaultData: () => ({
      privateKey: '',
      chains: DEFAULT_METAMASK_CHAINS.map((c) => ({ ...c })),
      activeChainId: 1,
    }),
    serialize: (d) => ({
      privateKey: (d.privateKey as string) ?? '',
      chains: ((d.chains as ChainConfig[]) ?? []).map((c) => ({
        chainId: Number(c.chainId),
        rpcUrl: c.rpcUrl ?? '',
        name: c.name ?? '',
      })),
      activeChainId: Number(d.activeChainId ?? 1),
    }),
    inject: (d, ctx) => ({
      privateKey: (d.privateKey as string) ?? '',
      chains: (d.chains as ChainConfig[]) ?? [],
      activeChainId: Number(d.activeChainId ?? 1),
      onChange: (patch: Record<string, unknown>) => ctx.patch(patch),
    }),
    validate: (node) => {
      const errors: GraphError[] = [];
      const d = node.data as MetaMaskNodeData;
      if (!/^0x[0-9a-fA-F]{64}$/.test(d.privateKey ?? '')) {
        errors.push({ nodeId: node.id, message: 'MetaMask private key is invalid (0x + 64 hex)' });
      }
      if (!d.chains?.length) {
        errors.push({ nodeId: node.id, message: 'MetaMask node has no chains' });
      } else {
        if (d.chains.some((c) => !c.rpcUrl?.trim())) {
          errors.push({ nodeId: node.id, message: 'A MetaMask chain has no RPC URL' });
        }
        if (!d.chains.some((c) => c.chainId === d.activeChainId)) {
          errors.push({ nodeId: node.id, message: 'Active chain is not in the chain list' });
        }
      }
      return errors;
    },
  },
```

- [ ] **Step 4: Add `'metamask'` to `NODE_ORDER`**

```ts
export const NODE_ORDER: NodeType[] = [
  'profile',
  'goto',
  'wait',
  'agent',
  'screenshot',
  'record',
  'metamask',
];
```

- [ ] **Step 5: Typecheck the whole web app**

Run: `npx nx typecheck web`
Expected: no errors (the `NodeRegistry` mapped type is now satisfied; `NodeType` derives from `BoardNode['type']` which now includes `metamask`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/automation/nodes/registry.ts
git commit -m "feat(web): register MetaMask node in flow registry"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the browser-core suite**

Run: `npx nx test browser-core`
Expected: PASS (all suites incl. wallet-handler, viem-signer, provider-injection, cloak-browser.service).

- [ ] **Step 2: Run the automation-api suite**

Run: `npx nx test automation-api`
Expected: PASS (incl. resolve-chains, run.service).

- [ ] **Step 3: Run the web suite + typecheck**

Run: `npx nx test web && npx nx typecheck web`
Expected: PASS / no type errors.

- [ ] **Step 4: Lint touched projects**

Run: `npx nx run-many -t lint -p browser-core,automation-api,web`
Expected: PASS (fix any lint issues introduced).

- [ ] **Step 5: Manual smoke (optional, requires a dApp + funded burner on a testnet)**

Build a board: `Profile → MetaMask (burner key, testnet RPC) → Goto(dApp)`. Run it. Expected: the dApp shows the wallet connected to the burner address without any popup; a connect/sign/tx initiated by the dApp resolves via Node.

- [ ] **Step 6: Final commit (if any lint fixes were made)**

```bash
git add -A
git commit -m "chore: lint fixes for metamask wallet node"
```

---

## Self-Review Notes

- **Spec coverage:** connect/sign/typed/send/switch/add + read passthrough → Task 3; viem signing → Task 4; page provider + EIP-6963 + events → Task 5; context seams + flow-step types → Task 6; runFlow setup → Task 7; backend types/registry/mapping → Tasks 8-10; frontend types/component/registry → Tasks 11-13; tests/lint → Task 14. Plaintext-key security caveat surfaced in the node UI (Task 12) and validated in Tasks 9 & 13.
- **Type consistency:** `WalletChainConfig` (lib) and `ChainConfig`/`MetaMaskNodeData` (api + board) share the `{ chainId, rpcUrl, name }` shape; the `wallet` step shape is identical across `ResolvedFlowStep` (lib), `FlowStep` (api), `metamask.toSteps`, and `run.service` mapping. Binding name `__cloakWalletRequest` is defined once as `WALLET_BINDING_NAME` and reused.
- **No placeholders:** every code step includes full content; commands include expected output.
