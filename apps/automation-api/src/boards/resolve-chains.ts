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

export function resolveChains(graph: BoardGraph): FlowJob[] {
  const byId = new Map<string, BoardNode>(graph.nodes.map((n) => [n.id, n]));

  // Adjacency with the "at most one outgoing edge" rule enforced.
  const next = new Map<string, string>();
  for (const edge of graph.edges) {
    if (next.has(edge.source)) {
      throw new BoardGraphError(`Node ${edge.source} has multiple outgoing connections`);
    }
    next.set(edge.source, edge.target);
  }

  const profileNodes = graph.nodes.filter((n) => n.type === 'profile');

  // Duplicate-profile check across all profile nodes (ignoring null).
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
      const targetId = next.get(current);
      if (targetId === undefined) break;
      if (visited.has(targetId)) {
        throw new BoardGraphError(`Graph contains a cycle at node ${targetId}`);
      }
      visited.add(targetId);
      const target = byId.get(targetId);
      if (!target) throw new BoardGraphError(`Edge points to unknown node ${targetId}`);

      const descriptor = NODE_CHAIN_REGISTRY[target.type];
      if (!descriptor.toSteps) {
        // Root-only node (e.g. profile) wired into the middle of a chain.
        throw new BoardGraphError(`Profile node ${target.id} cannot appear inside a chain`);
      }
      const compile = descriptor.toSteps as (n: BoardNode, ctx: ChainContext) => ChainOutput;
      const out = compile(target, { priorSteps: steps });
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
