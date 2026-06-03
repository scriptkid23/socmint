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
