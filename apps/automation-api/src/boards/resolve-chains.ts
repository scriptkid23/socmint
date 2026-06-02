import { BoardGraphError } from './board.errors';
import type { BoardGraph, BoardNode } from './board.types';
import type { FlowStep } from '../runs/run.types';

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

export interface FlowJob {
  profileId: string;
  steps: FlowStep[];
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
      if (target.type === 'profile') {
        throw new BoardGraphError(`Profile node ${target.id} cannot appear inside a chain`);
      }
      if (target.type === 'goto') {
        if (!target.data.url || target.data.url.trim() === '') {
          throw new BoardGraphError(`Goto node ${target.id} has an empty url`);
        }
        steps.push({
          type: 'goto',
          url: target.data.url,
          waitUntil: target.data.waitUntil,
          timeoutMs: target.data.timeoutMs,
        });
      } else if (target.type === 'wait') {
        const ms = target.data.ms;
        if (!Number.isFinite(ms) || ms <= 0) {
          throw new BoardGraphError(`Wait node ${target.id} must have ms > 0`);
        }
        steps.push({ type: 'wait', ms });
      } else if (target.type === 'agent') {
        const d = target.data;
        if (!d.prompt?.trim()) {
          throw new BoardGraphError(`Agent node ${target.id} has empty prompt`);
        }
        if (!d.model?.trim()) {
          throw new BoardGraphError(`Agent node ${target.id} has empty model`);
        }
        if (d.provider !== 'ollama' && !d.apiKey?.trim()) {
          throw new BoardGraphError(`Agent node ${target.id} has empty apiKey`);
        }
        const domains =
          d.allowDomains?.length && d.allowDomains.length > 0
            ? d.allowDomains.map(normalizeHost)
            : deriveAllowDomains(steps);
        steps.push({
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
        });
      } else if (target.type === 'screenshot') {
        steps.push({ type: 'screenshot' });
      } else {
        throw new BoardGraphError(`Unknown node type in chain: ${(target as BoardNode).type}`);
      }
      current = targetId;
    }

    if (steps.length > 0) {
      jobs.push({ profileId: node.data.profileId, steps });
    }
  }

  return jobs;
}
