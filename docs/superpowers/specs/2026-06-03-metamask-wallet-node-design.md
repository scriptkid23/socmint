# MetaMask Wallet Node — Design

**Date:** 2026-06-03
**Status:** Approved (design)

## Summary

Add a **MetaMask node** to the Automation flow board. The node injects a **synthetic
EIP-1193 wallet provider** (`window.ethereum`) into the CloakBrowser context so that
downstream dApp pages can connect a wallet, request signatures, and submit on-chain
transactions — fully automated and headless, with no real MetaMask extension and no
human clicks.

The provider is a thin in-page shim; the actual signing happens **in Node** using
[`viem`](https://viem.sh) and a private key supplied in the node. The wallet
advertises itself as MetaMask (`isMetaMask: true`, EIP-6963 announce) so common dApps
detect it, but it is **not** the real extension.

Like the Agent node, it plugs into the existing board model: it resolves into a single
`wallet` step inside the per-profile chain executed by `RunService.executeFlow`, so it
inherits board persistence, per-profile locking, and parallel execution.

## Decisions (from brainstorming)

- **Goal:** reliability + headless + 100% auto-signing — **not** realism. We do **not**
  load the real MetaMask extension. (The original "inject real extension + keep in
  profile" idea was dropped in favor of a synthetic provider.)
- **Operations:** connect (`eth_requestAccounts`), `personal_sign`,
  `eth_signTypedData_v4`, `eth_sendTransaction`, `wallet_switchEthereumChain`,
  `wallet_addEthereumChain`, plus generic read passthrough. ERC-20 approve is just a
  `eth_sendTransaction`.
- **Key management:** private key entered directly in the node, stored **plaintext** in
  the board JSON (same as the Agent node's `apiKey`). Suitable for burner/test wallets.
- **Chains:** node holds a **manually entered list** of chains
  (`chainId` + `rpcUrl` + `name`), with one `activeChainId` selected as default.
- **Signing location (Approach A, chosen):** signer runs in **Node** (key never enters
  the dApp's JS context); page holds only a thin forwarding shim.
- **Library (chosen):** `viem` (TypeScript-first, tree-shakeable). No existing web3 lib
  in the repo.

## Architecture & Data Flow

```
apps/web (React Flow)            apps/automation-api (NestJS)        libs/browser-core
┌────────────────────┐  PATCH    ┌──────────────────────────┐      ┌────────────────────┐
│ FlowCanvas         │ ───────►  │ boards/                  │      │ CloakBrowserService │
│  └ MetaMaskNode    │ /boards   │  resolveChains(graph)    │      │  + runFlow()        │
│   privateKey       │           │   ↳ FlowStep 'wallet'    │      │                     │
│   chains[]         │  POST     │ runs/                    │      │ wallet/             │
│   activeChainId    │ ───────►  │  RunService.executeFlow  │ ───► │  WalletHandler(viem)│
└────────────────────┘ /run      │   ↳ ResolvedFlowStep     │      │  provider-injection │
                                  └──────────────────────────┘      └────────────────────┘

Page (dApp)                                  Node (browser-core)
  window.ethereum.request(payload) ──exposeFunction──▶ WalletHandler.handle(payload)
                                                          ├ sign / send (private key in Node)
                                                          └ read passthrough → active-chain RPC
  ◀── result / events (accountsChanged, chainChanged) ──
```

**Run flow:**
1. User adds a MetaMask node, fills private key + chains + active chain, wires it after a
   Profile node and before the dApp Goto node(s). Autosaves via `PATCH /boards/:id`.
2. **Run** → `POST /boards/:id/run`.
3. `resolveChains(graph)` emits a `wallet` step for the node.
4. `RunService.executeFlow` maps it to a `ResolvedFlowStep` of type `wallet` and runs the
   chain on one CloakBrowser context. The `wallet` step:
   - constructs a `WalletHandler` (viem account from the private key + per-chain clients),
   - registers `context.exposeFunction('__cloakWalletRequest', handler)`,
   - registers `context.addInitScript(providerInjectionScript)`.
5. Every subsequent `goto` navigation loads a page with `window.ethereum` present and the
   EIP-6963 provider announced. The wallet stays active for the rest of the chain.

The `wallet` step is a **setup** step (like `profile`): it does not navigate or produce a
visible action; it returns `{ type: 'wallet', status: 'completed' }`.

## Components

### `libs/browser-core`

- **`wallet/wallet-handler.ts`** — given `{ privateKey, chains, activeChainId }`, exposes
  `handle(payload: { method, params }) => Promise<unknown>`. Uses viem:
  `privateKeyToAccount`, `createWalletClient` / `createPublicClient` with
  `http(rpcUrl)` per chain, a minimal inline chain object built from
  `{ chainId, rpcUrl, name }`. Holds the current chain id (mutable for switch/add).
- **`wallet/provider-injection.ts`** — exports the page-side injection script (a string /
  function) that builds `window.ethereum`: an EIP-1193 object whose `request()` forwards
  to `__cloakWalletRequest`, an event emitter (`accountsChanged`, `chainChanged`),
  `isMetaMask: true`, and an EIP-6963 `announceProvider` responder.
- **`types.ts`** — extend `BrowserContextLike` with `addInitScript(script)` and
  `exposeFunction(name, fn)` (both exist on Playwright's `BrowserContext`). Add the
  `ResolvedFlowStep` variant `{ type: 'wallet'; privateKey; chains; activeChainId }` and
  the `FlowStepResult` variant `{ type: 'wallet'; status; error }`.
- **`cloak-browser.service.ts`** — handle the `wallet` step inside `runFlow` (set up the
  handler + `exposeFunction` + `addInitScript`, push a `wallet` result). The in-memory
  fake context used by specs gains no-op `addInitScript` / `exposeFunction`.

### `apps/automation-api`

- **`boards/board.types.ts`** — add `MetaMaskNodeData` and the `metamask` variant to the
  `BoardNode` union.
- **`boards/node-registry.ts`** — `metamask.toSteps` validates the node and emits a
  `wallet` `FlowStep`.
- **`runs/run.types.ts`** — add the `wallet` variant to `FlowStep` and `'wallet'` to
  `FlowStepRecord.type`.
- **`runs/run.service.ts`** — map the `wallet` `FlowStep` to the `wallet`
  `ResolvedFlowStep` in `executeFlow`.

### `apps/web`

- **`api/client`** — add `MetaMaskNodeData` (and a `ChainConfig` type) to the shared types.
- **`components/automation/nodes/metamask-node.tsx`** — node UI: private key input
  (masked), editable chain list, active-chain selector, derived address shown read-only
  (via viem `privateKeyToAccount` in the browser).
- **`components/automation/nodes/registry.ts`** — add the `metamask` descriptor
  (`defaultData` / `serialize` / `inject` / `validate`) and `'metamask'` to `NODE_ORDER`
  and the `NodeType` union.

### Dependency

- Add **`viem`** to the workspace (used by `browser-core` for signing; `apps/web` uses it
  only to derive the display address).

## Node Data Model

Board (serialized) shape:

```ts
interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  name: string;
}

interface MetaMaskNodeData {
  privateKey: string;        // "0x" + 64 hex; plaintext in board JSON
  chains: ChainConfig[];
  activeChainId: number;     // must be present in chains
}
```

## Provider Behavior (RPC methods)

| Method | Node handling |
|---|---|
| `eth_requestAccounts` / `eth_accounts` | return `[address]` (auto-approve connect) |
| `eth_chainId` / `net_version` | active chain id |
| `personal_sign` | `account.signMessage` |
| `eth_signTypedData_v4` | parse JSON, strip `EIP712Domain`, `account.signTypedData` |
| `eth_sendTransaction` | build → sign → broadcast via active-chain RPC → return tx hash |
| `wallet_switchEthereumChain` | switch active (must be in list) + emit `chainChanged`; unknown chain → error 4902 |
| `wallet_addEthereumChain` | append `{ chainId, rpcUrl, name }` to the runtime list |
| other reads (`eth_call`, `eth_getBalance`, `eth_estimateGas`, …) | passthrough to active-chain RPC via `publicClient.request` |
| unsupported | EIP-1193 error code 4200 |

All operations auto-approve with no prompt.

## Error Handling

- Unsupported method → EIP-1193 `{ code: 4200 }`. Switch to an unknown chain →
  `{ code: 4902 }`. Sign/broadcast failures reject the page-side `request()` promise with
  the underlying message.
- A failing `wallet` step (e.g. invalid key at runtime) is recorded as
  `{ type: 'wallet', status: 'failed', error }` and stops the chain, matching existing
  step semantics.

## Validation

Node-level (frontend `validate` + backend `toSteps`):
- `privateKey` matches `^0x[0-9a-fA-F]{64}$`.
- `chains` non-empty; every chain has a non-empty `rpcUrl` and a positive integer
  `chainId`.
- `activeChainId` is present in `chains`.

## Security

- The private key stays in Node and is **never** injected into the dApp's JS context, so a
  malicious dApp cannot read or exfiltrate it.
- The key is still stored **plaintext** in `data/boards/*.json` (consistent with the Agent
  node's `apiKey`). **Recommendation: use burner/test wallets only.** This caveat is
  surfaced in the node UI.

## Testing

- Unit-test `wallet-handler` with a fake viem account + stubbed RPC: `personal_sign`,
  `eth_signTypedData_v4`, `eth_sendTransaction` (build/sign), `wallet_switchEthereumChain`
  validation (known vs unknown chain), and read passthrough. Follow the
  `agent-runner.spec.ts` seam pattern.
- `node-registry` / `resolve-chains` specs: a `metamask` node compiles to one `wallet`
  step; invalid key / empty chains / bad `activeChainId` throw `BoardGraphError`.
- The page-side injection script stays thin and is exercised indirectly; the handler holds
  the testable logic.

## Out of Scope (YAGNI)

- Real MetaMask extension loading / persistence.
- Per-transaction approval policies, value limits, contract allowlists.
- `eth_signTypedData_v1`/`v3`, `eth_sign` (legacy).
- Encrypted key storage / profile-bound keys / key generation (can revisit later).
