import type { WalletProviderConfig } from './wallet.types';
import { INPAGE_WALLET_BUNDLE } from './inpage/inpage-bundle.generated';

/**
 * Build the page init script that installs a MetaMask-like EIP-1193 provider.
 *
 * cloakbrowser strips Playwright's binding global, so a Node round-trip
 * (exposeFunction) never returns. Instead we inject a fully self-contained,
 * viem-backed provider that signs in-page. The private key is embedded in the
 * page context — acceptable for burner/test wallets only.
 *
 * The provider source lives in `inpage/provider-entry.ts` and is bundled into
 * `INPAGE_WALLET_BUNDLE` by `scripts/build-wallet-inpage.mjs`.
 */
export function buildWalletInitScript(config: WalletProviderConfig): string {
  return `window.__CLOAK_WALLET_CONFIG__ = ${JSON.stringify(config)};\n${INPAGE_WALLET_BUNDLE}`;
}
