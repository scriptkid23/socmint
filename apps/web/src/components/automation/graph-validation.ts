import type { BoardGraph, GotoNodeData, ProfileNodeData } from '../../api/client';

export interface GraphError {
  nodeId: string;
  message: string;
}

export function validateGraph(graph: BoardGraph): GraphError[] {
  const errors: GraphError[] = [];

  const outgoing = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }
  for (const [nodeId, count] of outgoing) {
    if (count > 1) {
      errors.push({ nodeId, message: 'Node has more than one outgoing connection' });
    }
  }

  const profileIds = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type === 'profile') {
      const pid = (node.data as ProfileNodeData).profileId;
      if (pid === null) {
        errors.push({ nodeId: node.id, message: 'No profile selected' });
      } else {
        profileIds.set(pid, (profileIds.get(pid) ?? 0) + 1);
      }
    } else if (node.type === 'goto') {
      const url = (node.data as GotoNodeData).url;
      if (!url || url.trim() === '') {
        errors.push({ nodeId: node.id, message: 'Goto URL is empty' });
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
