import { NODE_DESCRIPTORS, NODE_ORDER, type NodeType } from './nodes/registry';
import { Button } from '../ui/button';

export function NodePalette({
  onAdd,
  disabled,
}: {
  onAdd: (type: NodeType) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="min-h-0 flex-1 overflow-auto">
      {NODE_ORDER.map((type) => (
        <li key={type} className="border-b border-border-light">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onAdd(type)}
            className="h-auto w-full justify-start rounded-none border-0 px-4 py-3 font-mono text-xs uppercase tracking-wide"
          >
            + {NODE_DESCRIPTORS[type].label}
          </Button>
        </li>
      ))}
    </ul>
  );
}
