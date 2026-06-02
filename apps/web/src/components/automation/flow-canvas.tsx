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
  api,
  type Board,
  type BoardGraph,
  type BoardNodeData,
  type BoardRunRecord,
  type Profile,
  type WaitUntil,
} from '../../api/client';
import { validateGraph } from './graph-validation';
import { ProfileNode } from './nodes/profile-node';
import { GotoNode } from './nodes/goto-node';
import { ScreenshotNode } from './nodes/screenshot-node';
import { Button } from '../ui/button';

const nodeTypes = { profile: ProfileNode, goto: GotoNode, screenshot: ScreenshotNode };

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`;

function toGraph(nodes: Node[], edges: Edge[]): BoardGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as BoardGraph['nodes'][number]['type'],
      position: n.position,
      data: stripData(n.type, n.data as Record<string, unknown>),
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function stripData(type: string | undefined, data: Record<string, unknown>): BoardNodeData {
  if (type === 'profile') return { profileId: (data.profileId as string | null) ?? null };
  if (type === 'goto')
    return {
      url: (data.url as string) ?? '',
      waitUntil: data.waitUntil as WaitUntil | undefined,
    };
  return {};
}

export function FlowCanvas({ board, profiles }: { board: Board; profiles: Profile[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BoardRunRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes],
  );

  const injectData = useCallback(
    (type: string, data: Record<string, unknown>, id: string) => {
      if (type === 'profile') {
        return {
          profileId: (data.profileId as string | null) ?? null,
          profiles,
          onChange: (profileId: string | null) => patchNodeData(id, { profileId }),
        };
      }
      if (type === 'goto') {
        return {
          url: (data.url as string) ?? '',
          waitUntil: data.waitUntil as WaitUntil | undefined,
          onChange: (patch: Record<string, unknown>) => patchNodeData(id, patch),
        };
      }
      return {};
    },
    [profiles, patchNodeData],
  );

  useEffect(() => {
    const seeded: Node[] = board.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: injectData(n.type, n.data as Record<string, unknown>, n.id),
    }));
    setNodes(seeded);
    setEdges(board.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.type === 'profile' ? { ...n, data: { ...n.data, profiles } } : n)));
  }, [profiles, setNodes]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: newId('e') }, eds)),
    [setEdges],
  );

  const addNode = (type: 'profile' | 'goto' | 'screenshot') => {
    const id = newId(type);
    const position = { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 };
    setNodes((ns) => [...ns, { id, type, position, data: injectData(type, {}, id) }]);
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
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-foreground px-4 py-3">
        <Button onClick={() => addNode('profile')} className="gap-1 text-xs">
          + Profile
        </Button>
        <Button onClick={() => addNode('goto')} className="gap-1 text-xs">
          + Goto
        </Button>
        <Button onClick={() => addNode('screenshot')} className="gap-1 text-xs">
          + Screenshot
        </Button>
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
          <ul className="space-y-1">
            {result.runs.map((r) => (
              <li key={r.id} className="font-mono text-xs">
                {r.profileId} — {r.status}
                {r.error ? ` (${r.error})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
