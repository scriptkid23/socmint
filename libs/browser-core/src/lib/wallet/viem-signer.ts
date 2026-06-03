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
        types,
        primaryType: data.primaryType,
        message: data.message,
      } as never);
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
