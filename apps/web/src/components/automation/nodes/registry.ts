import type { Edge, Node, NodeTypes } from '@xyflow/react';
import {
  api,
  type AgentNodeData,
  type AgentProvider,
  type BoardNode,
  type BoardNodeData,
  type GotoNodeData,
  type Profile,
  type ProfileNodeData,
  type RecordedStep,
  type WaitNodeData,
  type WaitUntil,
} from '../../../api/client';
import { ProfileNode } from './profile-node';
import { GotoNode } from './goto-node';
import { WaitNode } from './wait-node';
import { AgentNode } from './agent-node';
import { ScreenshotNode } from './screenshot-node';
import { RecordNode } from './record-node';

export const DEFAULT_WAIT_MS = 3000;
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export type NodeType = BoardNode['type'];

export interface GraphError {
  nodeId: string;
  message: string;
}

/**
 * Everything a node's runtime `inject` step needs from the canvas. Bundling it
 * here keeps node descriptors decoupled from FlowCanvas internals (refs, api).
 */
export interface NodeRuntimeContext {
  id: string;
  profiles: Profile[];
  /** Merge a patch into this node's data. */
  patch: (patch: Record<string, unknown>) => void;
  /** Current canvas nodes (live, via ref). */
  getNodes: () => Node[];
  /** Current canvas edges (live, via ref). */
  getEdges: () => Edge[];
  /** Persist a node snapshot immediately (bypasses debounce). */
  persistNodes: (nodes: Node[]) => Promise<void>;
  /** Expand a record node's navigations into a chain of Goto nodes. */
  generateGotoChain: (recordNodeId: string, steps: RecordedStep[]) => void;
}

interface NodeDescriptor {
  /** Toolbar label; the rendered header lives inside the component. */
  label: string;
  component: NodeTypes[string];
  /** Seed data for a freshly added node (pre-inject). */
  defaultData: () => Record<string, unknown>;
  /** Strip runtime handlers down to the persistable board shape. */
  serialize: (data: Record<string, unknown>) => BoardNodeData;
  /** Build runtime data (with handlers) from persisted data. */
  inject: (data: Record<string, unknown>, ctx: NodeRuntimeContext) => Record<string, unknown>;
  /** Per-node field validation (topology checks stay in graph-validation). */
  validate?: (node: BoardNode) => GraphError[];
}

/**
 * One descriptor per node type. `Record<NodeType, …>` forces every node type to
 * be present — adding a value to the `BoardNode['type']` union turns this object
 * into a compile error until the new type is handled here.
 */
type NodeRegistry = Record<NodeType, NodeDescriptor>;

/** Walk upstream from a node to the profile that feeds its chain. */
export function resolveUpstreamProfile(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): string | null {
  const incoming = edges.find((e) => e.target === nodeId);
  if (!incoming) return null;
  const source = nodes.find((n) => n.id === incoming.source);
  if (!source) return null;
  if (source.type === 'profile') {
    return (source.data as { profileId?: string | null }).profileId ?? null;
  }
  return resolveUpstreamProfile(source.id, nodes, edges);
}

export const NODE_DESCRIPTORS: NodeRegistry = {
  profile: {
    label: 'Profile',
    component: ProfileNode,
    defaultData: () => ({ profileId: null }),
    serialize: (d) => ({ profileId: (d.profileId as string | null) ?? null }),
    inject: (d, ctx) => ({
      profileId: (d.profileId as string | null) ?? null,
      profiles: ctx.profiles,
      onChange: (profileId: string | null) => ctx.patch({ profileId }),
    }),
    validate: (node) =>
      (node.data as ProfileNodeData).profileId === null
        ? [{ nodeId: node.id, message: 'No profile selected' }]
        : [],
  },

  goto: {
    label: 'Goto',
    component: GotoNode,
    defaultData: () => ({ url: '', waitUntil: 'load' }),
    serialize: (d) => ({
      url: (d.url as string) ?? '',
      waitUntil: d.waitUntil as WaitUntil | undefined,
    }),
    inject: (d, ctx) => ({
      url: (d.url as string) ?? '',
      waitUntil: d.waitUntil as WaitUntil | undefined,
      onChange: (patch: Record<string, unknown>) => ctx.patch(patch),
    }),
    validate: (node) => {
      const url = (node.data as GotoNodeData).url;
      return !url || url.trim() === '' ? [{ nodeId: node.id, message: 'Goto URL is empty' }] : [];
    },
  },

  wait: {
    label: 'Wait',
    component: WaitNode,
    defaultData: () => ({ ms: DEFAULT_WAIT_MS }),
    serialize: (d) => {
      const ms = Number(d.ms);
      return { ms: Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_WAIT_MS };
    },
    inject: (d, ctx) => {
      const ms = Number(d.ms);
      return {
        ms: Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_WAIT_MS,
        onChange: (nextMs: number) => ctx.patch({ ms: nextMs }),
      };
    },
    validate: (node) => {
      const ms = (node.data as WaitNodeData).ms;
      return !Number.isFinite(ms) || ms <= 0
        ? [{ nodeId: node.id, message: 'Wait duration must be greater than 0 ms' }]
        : [];
    },
  },

  agent: {
    label: 'Agent',
    component: AgentNode,
    defaultData: () => ({
      prompt: '',
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      restrictToGotoDomains: false,
      readOnly: true,
    }),
    serialize: (d) => ({
      prompt: (d.prompt as string) ?? '',
      provider: (d.provider as AgentProvider) ?? 'openai',
      model: (d.model as string) ?? 'gpt-4o-mini',
      apiKey: (d.apiKey as string) ?? '',
      baseUrl: d.baseUrl as string | undefined,
      maxSteps: d.maxSteps as number | undefined,
      timeoutMs: d.timeoutMs as number | undefined,
      restrictToGotoDomains: d.restrictToGotoDomains === true,
      readOnly: d.readOnly !== false,
    }),
    inject: (d, ctx) => ({
      prompt: (d.prompt as string) ?? '',
      provider: (d.provider as AgentProvider) ?? 'openai',
      model: (d.model as string) ?? 'gpt-4o-mini',
      apiKey: (d.apiKey as string) ?? '',
      baseUrl: d.baseUrl as string | undefined,
      maxSteps: d.maxSteps as number | undefined,
      timeoutMs: d.timeoutMs as number | undefined,
      restrictToGotoDomains: d.restrictToGotoDomains === true,
      readOnly: d.readOnly !== false,
      onChange: (patch: Record<string, unknown>) => ctx.patch(patch),
    }),
    validate: (node) => {
      const errors: GraphError[] = [];
      const d = node.data as AgentNodeData;
      if (!d.prompt?.trim()) errors.push({ nodeId: node.id, message: 'Agent prompt is empty' });
      if (!d.model?.trim()) errors.push({ nodeId: node.id, message: 'Agent model is empty' });
      if (d.provider !== 'ollama' && !d.apiKey?.trim()) {
        errors.push({ nodeId: node.id, message: 'Agent API key is empty' });
      }
      return errors;
    },
  },

  screenshot: {
    label: 'Screenshot',
    component: ScreenshotNode,
    defaultData: () => ({}),
    serialize: () => ({}),
    inject: () => ({}),
  },

  record: {
    label: 'Record',
    component: RecordNode,
    defaultData: () => ({ steps: [], recording: false }),
    serialize: (d) => ({ steps: (d.steps as RecordedStep[]) ?? [] }),
    inject: (d, ctx) => {
      const profileId = resolveUpstreamProfile(ctx.id, ctx.getNodes(), ctx.getEdges());
      return {
        steps: (d.steps as RecordedStep[]) ?? [],
        profileId,
        recording: Boolean(d.recording),
        onStart: async () => {
          if (!profileId) return;
          await api.startRecording(profileId);
          ctx.patch({ recording: true });
        },
        onStop: async () => {
          if (!profileId) return;
          try {
            const { steps } = await api.stopRecording(profileId);
            ctx.patch({ steps, recording: false });
            const nextNodes = ctx.getNodes().map((n) =>
              n.id === ctx.id ? { ...n, data: { ...n.data, steps, recording: false } } : n,
            );
            await ctx.persistNodes(nextNodes);
          } catch {
            ctx.patch({ recording: false });
          }
        },
        onClear: () => ctx.patch({ steps: [] }),
        onGenerateGoto: () => {
          const node = ctx.getNodes().find((n) => n.id === ctx.id);
          const steps = (node?.data as { steps?: RecordedStep[] }).steps ?? [];
          ctx.generateGotoChain(ctx.id, steps);
        },
      };
    },
  },
};

/** Toolbar / add-button order. */
export const NODE_ORDER: NodeType[] = [
  'profile',
  'goto',
  'wait',
  'agent',
  'screenshot',
  'record',
];

/** Component map for ReactFlow's `nodeTypes` prop. */
export const nodeTypes: NodeTypes = Object.fromEntries(
  NODE_ORDER.map((type) => [type, NODE_DESCRIPTORS[type].component]),
);

function descriptorFor(type: string | undefined): NodeDescriptor | undefined {
  return type && type in NODE_DESCRIPTORS ? NODE_DESCRIPTORS[type as NodeType] : undefined;
}

export function defaultNodeData(type: NodeType): Record<string, unknown> {
  return NODE_DESCRIPTORS[type].defaultData();
}

export function serializeNodeData(
  type: string | undefined,
  data: Record<string, unknown>,
): BoardNodeData {
  return descriptorFor(type)?.serialize(data) ?? {};
}

export function injectNodeData(
  type: string,
  data: Record<string, unknown>,
  ctx: NodeRuntimeContext,
): Record<string, unknown> {
  return descriptorFor(type)?.inject(data, ctx) ?? {};
}

export function validateNode(node: BoardNode): GraphError[] {
  return NODE_DESCRIPTORS[node.type].validate?.(node) ?? [];
}
