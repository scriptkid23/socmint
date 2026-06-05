import { BoardGraphError } from './board.errors';
import type { BoardNode } from './board.types';
import type { FlowStep } from '../runs/run.types';
import { compileRecordedSteps } from './recorded-steps-to-flow';

type NodeOfType<T extends BoardNode['type']> = Extract<BoardNode, { type: T }>;

export interface ChainContext {
  /** Flow steps already emitted earlier in this chain (e.g. for deriving allow-domains). */
  priorSteps: FlowStep[];
}

export interface ChainOutput {
  steps: FlowStep[];
  /** Chain ends on this node and the browser should stay open for manual capture. */
  endsWithRecord?: boolean;
}

interface ChainDescriptor<N extends BoardNode> {
  /**
   * Compile a node that sits inside a chain body into flow steps. Throws
   * BoardGraphError on invalid data. Omit for "root-only" node types (e.g.
   * `profile`) that may never appear inside a chain.
   */
  toSteps?: (node: N, ctx: ChainContext) => ChainOutput;
}

/**
 * One descriptor per node type, keyed by `type`. The mapped-type signature
 * forces every BoardNode variant to be present — adding a new node type to the
 * `BoardNode` union turns this object into a compile error until it is handled.
 */
type ChainRegistry = { [T in BoardNode['type']]: ChainDescriptor<NodeOfType<T>> };

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

function hostFromUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function deriveAllowDomains(steps: FlowStep[]): string[] {
  const hosts = new Set<string>();
  for (const step of steps) {
    if (step.type === 'goto') {
      const h = hostFromUrl(step.url);
      if (h) hosts.add(h);
    }
  }
  return [...hosts];
}

export const NODE_CHAIN_REGISTRY: ChainRegistry = {
  // Root-only: a profile node starts a chain, it can never sit inside one.
  profile: {},

  goto: {
    toSteps(node) {
      if (!node.data.url || node.data.url.trim() === '') {
        throw new BoardGraphError(`Goto node ${node.id} has an empty url`);
      }
      return {
        steps: [
          {
            type: 'goto',
            url: node.data.url,
            waitUntil: node.data.waitUntil,
            timeoutMs: node.data.timeoutMs,
          },
        ],
      };
    },
  },

  wait: {
    toSteps(node) {
      const ms = node.data.ms;
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new BoardGraphError(`Wait node ${node.id} must have ms > 0`);
      }
      return { steps: [{ type: 'wait', ms }] };
    },
  },

  agent: {
    toSteps(node, ctx) {
      const d = node.data;
      if (!d.prompt?.trim()) {
        throw new BoardGraphError(`Agent node ${node.id} has empty prompt`);
      }
      if (!d.model?.trim()) {
        throw new BoardGraphError(`Agent node ${node.id} has empty model`);
      }
      if (d.provider !== 'ollama' && !d.apiKey?.trim()) {
        throw new BoardGraphError(`Agent node ${node.id} has empty apiKey`);
      }
      const domains =
        d.allowDomains?.length && d.allowDomains.length > 0
          ? d.allowDomains.map(normalizeHost)
          : d.restrictToGotoDomains
            ? deriveAllowDomains(ctx.priorSteps)
            : [];
      return {
        steps: [
          {
            type: 'agent',
            prompt: d.prompt,
            provider: d.provider,
            model: d.model,
            apiKey: d.apiKey ?? '',
            baseUrl: d.baseUrl,
            maxSteps: d.maxSteps ?? 25,
            timeoutMs: d.timeoutMs ?? 300_000,
            allowDomains: domains,
            readOnly: d.readOnly ?? true,
          },
        ],
      };
    },
  },

  screenshot: {
    toSteps() {
      return { steps: [{ type: 'screenshot' }] };
    },
  },

  record: {
    toSteps(node) {
      const mode = node.data.mode ?? 'record';
      if (mode === 'replay') {
        return {
          steps: compileRecordedSteps(node.data.steps ?? [], node.id, node.data.replayDelayMs),
        };
      }
      const steps: FlowStep[] = [];
      for (const s of node.data.steps ?? []) {
        if (s.type === 'navigate' && s.url?.trim() && !s.url.startsWith('about:')) {
          steps.push({ type: 'goto', url: s.url.trim() });
          steps.push({ type: 'wait', ms: 800 });
        }
      }
      return { steps, endsWithRecord: true };
    },
  },

  metamask: {
    toSteps(node) {
      const d = node.data;
      if (!/^0x[0-9a-fA-F]{64}$/.test(d.privateKey ?? '')) {
        throw new BoardGraphError(`MetaMask node ${node.id} has an invalid private key`);
      }
      if (!d.chains?.length) {
        throw new BoardGraphError(`MetaMask node ${node.id} has no chains`);
      }
      for (const c of d.chains) {
        if (!Number.isInteger(c.chainId) || c.chainId <= 0) {
          throw new BoardGraphError(`MetaMask node ${node.id} has an invalid chainId`);
        }
        if (!c.rpcUrl?.trim()) {
          throw new BoardGraphError(`MetaMask node ${node.id} has a chain with no rpcUrl`);
        }
      }
      if (!d.chains.some((c) => c.chainId === d.activeChainId)) {
        throw new BoardGraphError(`MetaMask node ${node.id} activeChainId is not in its chains`);
      }
      return {
        steps: [
          {
            type: 'wallet',
            privateKey: d.privateKey,
            chains: d.chains.map((c) => ({ chainId: c.chainId, rpcUrl: c.rpcUrl, name: c.name })),
            activeChainId: d.activeChainId,
          },
        ],
      };
    },
  },

  fill: {
    toSteps(node) {
      const selector = node.data.selector?.trim();
      if (!selector) {
        throw new BoardGraphError(`Fill node ${node.id} has an empty selector`);
      }
      return { steps: [{ type: 'fill', selector, value: node.data.value ?? '' }] };
    },
  },

  click: {
    toSteps(node) {
      const selector = node.data.selector?.trim();
      if (!selector) {
        throw new BoardGraphError(`Click node ${node.id} has an empty selector`);
      }
      return { steps: [{ type: 'click', selector }] };
    },
  },

  // Branching is compiled in resolve-chains (subgraph walk); no leaf steps here.
  if: {},

  script: {
    toSteps(node) {
      const code = node.data.code ?? '';
      if (!code.trim()) {
        throw new BoardGraphError(`Script node ${node.id} has empty code`);
      }
      return { steps: [{ type: 'script', code }] };
    },
  },
};
