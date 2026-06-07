import { buildWalletInitScript } from './provider-injection';
import type { WalletProviderConfig } from './wallet.types';

describe('buildWalletInitScript', () => {
  const config: WalletProviderConfig = {
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    chains: [{ chainId: 84532, rpcUrl: 'https://base-sepolia-rpc.publicnode.com', name: 'Base Sepolia' }],
    activeChainId: 84532,
  };
  const script = buildWalletInitScript(config);

  it('embeds the wallet config (key + active chain) for the in-page provider', () => {
    expect(script).toContain('__CLOAK_WALLET_CONFIG__');
    expect(script).toContain(config.privateKey);
    expect(script).toContain('84532');
  });

  it('includes the bundled provider that installs window.ethereum + EIP-6963', () => {
    expect(script).toContain('eip6963:announceProvider');
    expect(script).toContain('__cloakWalletInstalled');
  });
});
