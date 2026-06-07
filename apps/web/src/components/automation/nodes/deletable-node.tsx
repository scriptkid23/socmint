import { useReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { ComponentType } from 'react';

/**
 * Wraps a node component with a small "×" delete button in the top-right
 * corner. Deleting via `deleteElements` also removes the node's connected
 * edges and flows through the canvas's controlled state (autosave included).
 */
export function withDeletable(Node: NodeTypes[string]): ComponentType<NodeProps> {
  return function DeletableNode(props: NodeProps) {
    const { deleteElements } = useReactFlow();
    return (
      <div className="relative">
        <button
          type="button"
          // `nodrag`/`nopan` keep the click from dragging/panning the canvas.
          // Sits inside the node's header bar (dark bg, light text), right-aligned
          // on the same row as the title.
          className="nodrag nopan absolute right-2 top-1 z-10 font-mono text-sm leading-none text-background hover:text-background/70"
          title="Delete node"
          onClick={(e) => {
            e.stopPropagation();
            void deleteElements({ nodes: [{ id: props.id }] });
          }}
        >
          ×
        </button>
        <Node {...props} />
      </div>
    );
  };
}
