import { BoardGraphError } from './board.errors';
import type { BoardGraph, BoardNode } from './board.types';
import type { FlowStep } from '../runs/run.types';
import { NODE_CHAIN_REGISTRY, type ChainContext, type ChainOutput } from './node-registry';

export interface FlowJob {
  profileId: string;
  steps: FlowStep[];
  /** Chain ends on a Record node — keep browser open for manual capture after steps. */
  endsWithRecord?: boolean;
}

type OutEdge = { target: string; sourceHandle?: 'true' | 'false' };

function buildOutgoing(graph: BoardGraph): Map<string, OutEdge[]> {
  const outgoing = new Map<string, OutEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push({ target: edge.target, sourceHandle: edge.sourceHandle });
    outgoing.set(edge.source, list);
  }
  return outgoing;
}

function assertOutgoingRules(byId: Map<string, BoardNode>, outgoing: Map<string, OutEdge[]>): void {
  for (const [sourceId, edges] of outgoing) {
    const source = byId.get(sourceId);
    if (source?.type === 'if') {
      if (edges.length > 2) {
        throw new BoardGraphError(`If node ${sourceId} has more than two outgoing connections`);
      }
      const handles = edges.map((e) => e.sourceHandle);
      if (handles.some((h) => h !== 'true' && h !== 'false')) {
        throw new BoardGraphError(
          `If node ${sourceId} outgoing edges must use sourceHandle "true" or "false"`,
        );
      }
      if (new Set(handles).size !== handles.length) {
        throw new BoardGraphError(`If node ${sourceId} has duplicate branch handles`);
      }
      continue;
    }
    if (edges.length > 1) {
      throw new BoardGraphError(`Node ${sourceId} has multiple outgoing connections`);
    }
  }
}

function linearNext(outgoing: Map<string, OutEdge[]>, nodeId: string): string | undefined {
  const edges = outgoing.get(nodeId);
  if (!edges?.length) return undefined;
  if (edges.length > 1) {
    throw new BoardGraphError(`Node ${nodeId} has multiple outgoing connections`);
  }
  return edges[0].target;
}

function compileNodeSteps(node: BoardNode, priorSteps: FlowStep[]): ChainOutput {
  const descriptor = NODE_CHAIN_REGISTRY[node.type];
  if (!descriptor.toSteps) {
    throw new BoardGraphError(`Node type ${node.type} cannot appear inside a chain`);
  }
  const compile = descriptor.toSteps as (n: BoardNode, ctx: ChainContext) => ChainOutput;
  return compile(node, { priorSteps });
}

function compileIfNode(
  node: Extract<BoardNode, { type: 'if' }>,
  byId: Map<string, BoardNode>,
  outgoing: Map<string, OutEdge[]>,
): FlowStep[] {
  const selector = node.data.selector?.trim();
  if (!selector) {
    throw new BoardGraphError(`If node ${node.id} has an empty selector`);
  }
  const edges = outgoing.get(node.id) ?? [];
  const trueEdge = edges.find((e) => e.sourceHandle === 'true');
  const falseEdge = edges.find((e) => e.sourceHandle === 'false');
  const thenSteps = trueEdge ? compileSubchain(trueEdge.target, byId, outgoing) : [];
  const elseSteps = falseEdge ? compileSubchain(falseEdge.target, byId, outgoing) : [];
  return [
    {
      type: 'if',
      selector,
      condition: node.data.condition ?? 'exists',
      thenSteps,
      elseSteps,
    },
  ];
}

/** Walk a branch from `startId` until dead end or nested If (no merge). */
function compileSubchain(
  startId: string,
  byId: Map<string, BoardNode>,
  outgoing: Map<string, OutEdge[]>,
): FlowStep[] {
  const steps: FlowStep[] = [];
  const visited = new Set<string>();
  let current: string | undefined = startId;

  while (current) {
    if (visited.has(current)) {
      throw new BoardGraphError(`Graph contains a cycle at node ${current}`);
    }
    visited.add(current);
    const node = byId.get(current);
    if (!node) throw new BoardGraphError(`Edge points to unknown node ${current}`);

    if (node.type === 'if') {
      steps.push(...compileIfNode(node, byId, outgoing));
      break;
    }

    const out = compileNodeSteps(node, steps);
    steps.push(...out.steps);
    current = linearNext(outgoing, current);
  }

  return steps;
}

export function resolveChains(graph: BoardGraph): FlowJob[] {
  const byId = new Map<string, BoardNode>(graph.nodes.map((n) => [n.id, n]));
  const outgoing = buildOutgoing(graph);
  assertOutgoingRules(byId, outgoing);

  const profileNodes = graph.nodes.filter((n) => n.type === 'profile');

  const seen = new Set<string>();
  for (const node of profileNodes) {
    if (node.type !== 'profile') continue;
    const pid = node.data.profileId;
    if (pid === null) continue;
    if (seen.has(pid)) {
      throw new BoardGraphError(`Profile ${pid} is used by more than one node`);
    }
    seen.add(pid);
  }

  const jobs: FlowJob[] = [];
  for (const node of profileNodes) {
    if (node.type !== 'profile') continue;
    if (node.data.profileId === null) {
      throw new BoardGraphError(`Profile node ${node.id} has no profile selected`);
    }

    const steps: FlowStep[] = [];
    let endsWithRecord = false;
    const visited = new Set<string>([node.id]);
    let current = node.id;

    for (;;) {
      const targetId = linearNext(outgoing, current);
      if (targetId === undefined) break;
      if (visited.has(targetId)) {
        throw new BoardGraphError(`Graph contains a cycle at node ${targetId}`);
      }
      visited.add(targetId);
      const target = byId.get(targetId);
      if (!target) throw new BoardGraphError(`Edge points to unknown node ${targetId}`);

      if (target.type === 'if') {
        steps.push(...compileIfNode(target, byId, outgoing));
        break;
      }

      const out = compileNodeSteps(target, steps);
      steps.push(...out.steps);
      if (out.endsWithRecord) endsWithRecord = true;
      current = targetId;
    }

    if (steps.length > 0 || endsWithRecord) {
      jobs.push({ profileId: node.data.profileId, steps, endsWithRecord: endsWithRecord || undefined });
    }
  }

  return jobs;
}
