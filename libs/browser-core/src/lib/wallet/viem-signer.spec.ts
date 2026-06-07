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
