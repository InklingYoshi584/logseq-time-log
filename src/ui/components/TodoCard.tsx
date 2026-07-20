import type { TodoBlock } from "../types";

interface TodoCardProps {
  todo: TodoBlock;
  draggable: boolean;
  onDelete?: (uuid: string) => void;
  depth?: number;
}

const MARKER_LABELS: Record<string, string> = {
  TODO: "TODO",
  DOING: "DOING",
  NOW: "NOW",
  LATER: "LATER",
  WAITING: "WAITING",
  DONE: "DONE",
};

const MAX_DEPTH = 8;

export default function TodoCard({ todo, draggable, onDelete, depth = 0 }: TodoCardProps) {
  const indent = Math.min(depth, MAX_DEPTH);

  return (
    <>
      <div
        className={`todo-card marker-${todo.marker.toLowerCase()}${onDelete ? " todo-card--deletable" : ""}`}
        style={{ paddingLeft: `${12 + indent * 20}px` }}
        data-depth={indent}
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer.setData("text/plain", JSON.stringify({ uuid: todo.uuid, content: todo.content }));
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <span className="todo-marker">{MARKER_LABELS[todo.marker] ?? todo.marker}</span>
        {todo.priority && <span className="todo-priority">[{todo.priority}]</span>}
        <span className="todo-content">{todo.content}</span>
        {onDelete && (
          <button
            type="button"
            className="todo-delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(todo.uuid); }}
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
      {todo.children?.map((child) => (
        <TodoCard
          key={child.uuid}
          todo={child}
          draggable={draggable}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
