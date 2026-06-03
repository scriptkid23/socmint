import type { BoardGraph, ProfileNodeData } from '../../api/client';
import { validateNode, type GraphError } from './nodes/registry';

export type { GraphError } from './nodes/registry';

export function validateGraph(graph: BoardGraph): GraphError[] {
  const errors: GraphError[] = [];

  // Topology: at most one outgoing connection per node.
  const outgoing = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }
  for (const [nodeId, count] of outgoing) {
    if (count > 1) {
      errors.push({ nodeId, message: 'Node has more than one outgoing connection' });
    }
  }

  // Per-node field validation, delegated to each node's descriptor.
  for (const node of graph.nodes) {
    errors.push(...validateNode(node));
  }

  // Cross-node: a profile may only be used once.
  const profileIds = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type === 'profile') {
      const pid = (node.data as ProfileNodeData).profileId;
      if (pid !== null) {
        profileIds.set(pid, (profileIds.get(pid) ?? 0) + 1);
      }
    }
  }
  for (const node of graph.nodes) {
    if (node.type === 'profile') {
      const pid = (node.data as ProfileNodeData).profileId;
      if (pid !== null && (profileIds.get(pid) ?? 0) > 1) {
        errors.push({ nodeId: node.id, message: 'Profile is used by more than one node' });
      }
    }
  }

  return errors;
}
