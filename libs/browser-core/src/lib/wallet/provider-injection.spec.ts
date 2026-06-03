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
