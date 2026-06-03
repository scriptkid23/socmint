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
