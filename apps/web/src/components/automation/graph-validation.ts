import type { BoardGraph, BoardNode, ProfileNodeData } from '../../api/client';
import { validateNode, type GraphError } from './nodes/registry';

export type { GraphError } from './nodes/registry';

export function validateGraph(graph: BoardGraph): GraphError[] {
  const errors: GraphError[] = [];
  const byId = new Map<string, BoardNode>(graph.nodes.map((n) => [n.id, n]));

  const outgoing = new Map<string, Array<{ sourceHandle?: 'true' | 'false' }>>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push({ sourceHandle: edge.sourceHandle });
    outgoing.set(edge.source, list);
  }

  for (const [nodeId, edges] of outgoing) {
    const node = byId.get(nodeId);
    if (node?.type === 'if') {
      if (edges.length > 2) {
        errors.push({ nodeId, message: 'If node has more than two outgoing connections' });
      }
      const handles = edges.map((e) => e.sourceHandle);
      if (handles.some((h) => h !== 'true' && h !== 'false')) {
        errors.push({
          nodeId,
          message: 'If outgoing edges must connect from the true or false handle',
        });
      }
      if (new Set(handles).size !== handles.length) {
        errors.push({ nodeId, message: 'If node has duplicate branch handles' });
      }
      continue;
    }
    if (edges.length > 1) {
      errors.push({ nodeId, message: 'Node has more than one outgoing connection' });
    }
  }

  for (const node of graph.nodes) {
    errors.push(...validateNode(node));
  }

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
