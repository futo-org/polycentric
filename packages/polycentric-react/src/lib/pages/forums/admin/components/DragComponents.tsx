import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import React from 'react';

interface SortableItemProps {
  id: string;
  children: (listeners: object, attributes: object) => React.ReactNode;
}

export function SortableItem(props: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
    cursor: 'default',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {props.children(listeners ?? {}, attributes ?? {})}
    </div>
  );
}

interface DragHandleProps {
  listeners: object;
  attributes: object;
}

export function DragHandle({ listeners, attributes }: DragHandleProps) {
  return (
    <button
      {...attributes}
      {...listeners}
      className="p-1 text-gray-400 hover:text-gray-600 cursor-grab touch-none"
    >
      <GripVertical size={16} />
    </button>
  );
}
