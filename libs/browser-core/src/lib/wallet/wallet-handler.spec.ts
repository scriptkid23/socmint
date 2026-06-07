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

  it('grants eth_accounts permission for Reown/wagmi connect gating', async () => {
    const h = build();
    const granted = [{ parentCapability: 'eth_accounts', caveats: [] }];
    expect(
      await h.handle({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] }),
    ).toEqual(granted);
    expect(await h.handle({ method: 'wallet_getPermissions', params: [] })).toEqual(granted);
    expect(await h.handle({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })).toBeNull();
  });
});
