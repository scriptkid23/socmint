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
