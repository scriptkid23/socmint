import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ApiError,
  api,
  type Board,
  type BoardGraph,
  type BoardRunRecord,
  type Profile,
  type RecordedStep,
} from '../../api/client';
import { validateGraph } from './graph-validation';
import {
  NODE_DESCRIPTORS,
  NODE_ORDER,
  type NodeRuntimeContext,
  type NodeType,
  defaultNodeData,
  injectNodeData,
  nodeTypes,
  resolveUpstreamProfile,
  serializeNodeData,
} from './nodes/registry';
import { Button } from '../ui/button';

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

function toGraph(nodes: Node[], edges: Edge[]): BoardGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as BoardGraph['nodes'][number]['type'],
      position: n.position,
      data: serializeNodeData(n.type, n.data as Record<string, unknown>),
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function chainEndsWithRecord(profileNodeId: string, nodes: Node[], edges: Edge[]): boolean {
  const next = new Map(edges.map((e) => [e.source, e.target]));
  let current: string | undefined = profileNodeId;
  let lastType = 'profile';
  while (current && next.has(current)) {
    const targetId = next.get(current)!;
    const target = nodes.find((n) => n.id === targetId);
    lastType = target?.type ?? lastType;
    current = targetId;
  }
  return lastType === 'record';
}

export function FlowCanvas({ board, profiles }: { board: Board; profiles: Profile[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BoardRunRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);
  // Consecutive getRecording failures per record node (transient-error tolerance).
  const recordPollFailures = useRef<Map<string, number>>(new Map());

  const persistBoardNow = useCallback(
    async (nodesSnapshot: Node[]) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      setSaving(true);
      try {
        await api.updateBoard(board.id, { graph: toGraph(nodesSnapshot, edgesRef.current) });
      } finally {
        setSaving(false);
      }
    },
    [board.id],
  );

  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes],
  );

  // Lazily-read ref so makeContext can hand record nodes a generateGotoChain
  // without a circular useCallback dependency.
  const generateGotoChainRef = useRef<(recordNodeId: string, steps: RecordedStep[]) => void>(
    () => {},
  );

  const makeContext = useCallback(
    (id: string): NodeRuntimeContext => ({
      id,
      profiles,
      patch: (patch) => patchNodeData(id, patch),
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      persistNodes: persistBoardNow,
      generateGotoChain: (recordNodeId, steps) =>
        generateGotoChainRef.current(recordNodeId, steps),
    }),
    [profiles, patchNodeData, persistBoardNow],
  );

  const injectNode = useCallback(
    (type: string, data: Record<string, unknown>, id: string) =>
      injectNodeData(type, data, makeContext(id)),
    [makeContext],
  );

  const generateGotoChain = useCallback(
    (recordNodeId: string, steps: RecordedStep[]) => {
      const navs = steps.filter(
        (s): s is Extract<RecordedStep, { type: 'navigate' }> =>
          s.type === 'navigate' && Boolean(s.url?.trim()) && !s.url.startsWith('about:'),
      );
      if (navs.length === 0) return;

      const recordNode = nodesRef.current.find((n) => n.id === recordNodeId);
      if (!recordNode) return;

      const outEdge = edgesRef.current.find((e) => e.source === recordNodeId);
      const tailTarget = outEdge?.target;

      const gotoNodes: Node[] = navs.map((s, i) => {
        const gid = newId('goto');
        return {
          id: gid,
          type: 'goto',
          position: {
            x: recordNode.position.x + 220 * (i + 1),
            y: recordNode.position.y,
          },
          data: injectNode('goto', { url: s.url.trim(), waitUntil: 'load' }, gid),
        };
      });

      const newEdges: Edge[] = [];
      let prev = recordNodeId;
      for (const g of gotoNodes) {
        newEdges.push({ id: newId('e'), source: prev, target: g.id });
        prev = g.id;
      }
      if (tailTarget) {
        newEdges.push({ id: newId('e'), source: prev, target: tailTarget });
      }

      setNodes((ns) => [...ns, ...gotoNodes]);
      setEdges((eds) => {
        const withoutOld = tailTarget
          ? eds.filter((e) => !(e.source === recordNodeId && e.target === tailTarget))
          : eds.filter((e) => e.source !== recordNodeId);
        return [...withoutOld, ...newEdges];
      });
    },
    [setNodes, setEdges, injectNode],
  );
  generateGotoChainRef.current = generateGotoChain;

  useEffect(() => {
    const seeded: Node[] = board.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: injectNode(n.type, n.data as Record<string, unknown>, n.id),
    }));
    setNodes(seeded);
    setEdges(board.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.type === 'profile') return { ...n, data: { ...n.data, profiles } };
        if (n.type === 'record') {
          const profileId = resolveUpstreamProfile(n.id, ns, edges);
          return { ...n, data: { ...n.data, profileId } };
        }
        return n;
      }),
    );
  }, [profiles, edges, setNodes]);

  useEffect(() => {
    const recording = nodes.filter(
      (n) => n.type === 'record' && (n.data as { recording?: boolean }).recording,
    );
    if (recording.length === 0) return;

    const finalize = async (nodeId: string, profileId: string) => {
      // Session ended server-side (browser closed): pull cached/orphaned steps.
      try {
        const { steps } = await api.stopRecording(profileId);
        patchNodeData(nodeId, { steps, recording: false });
        if (steps.length > 0) {
          const nextNodes = nodesRef.current.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, steps, recording: false } } : node,
          );
          await persistBoardNow(nextNodes);
        }
      } catch {
        patchNodeData(nodeId, { recording: false });
      }
    };

    const poll = async () => {
      for (const n of recording) {
        const profileId = (n.data as { profileId?: string | null }).profileId;
        if (!profileId) continue;
        try {
          const status = await api.getRecording(profileId);
          recordPollFailures.current.delete(n.id);
          patchNodeData(n.id, { steps: status.steps });
        } catch (err) {
          // Only a definitive 404 means the recording session is truly gone
          // (user closed the browser). Transient errors (network blip, dev
          // server reload, 5xx) must NOT kill a still-live session.
          if (err instanceof ApiError && err.status === 404) {
            recordPollFailures.current.delete(n.id);
            await finalize(n.id, profileId);
            continue;
          }
          const fails = (recordPollFailures.current.get(n.id) ?? 0) + 1;
          recordPollFailures.current.set(n.id, fails);
          // Tolerate brief outages; keep polling without touching the session.
        }
      }
    };

    const id = setInterval(poll, 1500);
    poll();
    return () => clearInterval(id);
  }, [nodes, patchNodeData, persistBoardNow]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: newId('e') }, eds)),
    [setEdges],
  );

  const addNode = (type: NodeType) => {
    const id = newId(type);
    const position = { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 };
    setNodes((ns) => [
      ...ns,
      { id, type, position, data: injectNode(type, defaultNodeData(type), id) },
    ]);
  };

  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.updateBoard(board.id, { graph: toGraph(nodes, edges) });
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, board.id]);

  const validation = useMemo(() => validateGraph(toGraph(nodes, edges)), [nodes, edges]);

  const run = async () => {
    setErrorMsg(null);
    if (validation.length > 0) {
      setErrorMsg(validation.map((e) => e.message).join('; '));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      await api.updateBoard(board.id, { graph: toGraph(nodes, edges) });
      setResult(await api.runBoard(board.id));
      setNodes((ns) => {
        const profileNodes = ns.filter((n) => n.type === 'profile');
        return ns.map((n) => {
          if (n.type !== 'record') return n;
          if (((n.data as { mode?: string }).mode ?? 'record') !== 'record') return n;
          const profileNode = profileNodes.find((p) => {
            const pid = (p.data as { profileId?: string | null }).profileId;
            return pid && resolveUpstreamProfile(n.id, ns, edges) === pid;
          });
          if (!profileNode || !chainEndsWithRecord(profileNode.id, ns, edges)) return n;
          return { ...n, data: { ...n.data, recording: true } };
        });
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-foreground px-4 py-3">
        {NODE_ORDER.map((type) => (
          <Button key={type} onClick={() => addNode(type)} className="gap-1 text-xs">
            + {NODE_DESCRIPTORS[type].label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {saving ? 'Saving…' : 'Saved'}
          </span>
          <Button onClick={run} disabled={running} className="text-xs">
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {errorMsg && (
        <p className="shrink-0 border-b-2 border-foreground bg-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest text-background">
          {errorMsg}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {result && (
        <div className="max-h-48 shrink-0 overflow-auto border-t-2 border-foreground px-4 py-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Run results
          </p>
          <ul className="space-y-2">
            {result.runs.map((r) => (
              <li key={r.id} className="font-mono text-xs">
                <span>
                  {r.profileId} — {r.status}
                  {r.error ? ` (${r.error})` : ''}
                </span>
                {r.steps
                  ?.filter((s) => s.type === 'agent')
                  .map((s, i) => (
                    <pre
                      key={i}
                      className="mt-1 max-h-32 overflow-auto border border-border-light p-2 text-[10px]"
                    >
                      agent: {s.status} · {s.stepsUsed ?? 0} steps · {s.stopReason ?? '—'}
                      {s.result != null ? `\n${JSON.stringify(s.result, null, 2)}` : ''}
                    </pre>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
