import type { TodoBlock } from "../types";

interface TodoCardProps {
  todo: TodoBlock;
  draggable: boolean;
  onDelete?: (uuid: string) => void;
  onChangeMarker?: (uuid: string, marker: TodoBlock["marker"]) => void;
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

function nextMarker(current: TodoBlock["marker"]): TodoBlock["marker"] | null {
  if (current === "TODO") return "DOING";
  if (current === "DOING") return "TODO";
  return null; // DONE, NOW, LATER, WAITING — no toggle
}

export default function TodoCard({ todo, draggable, onDelete, onChangeMarker, depth = 0 }: TodoCardProps) {
  const indent = Math.min(depth, MAX_DEPTH);
  const toggleMarker = nextMarker(todo.marker);

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
        {/* Checkbox: toggle DONE ↔ TODO */}
        <button
          type="button"
          className={`todo-checkbox${todo.marker === "DONE" ? " checked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onChangeMarker?.(todo.uuid, todo.marker === "DONE" ? "TODO" : "DONE");
          }}
          title={todo.marker === "DONE" ? "Mark as TODO" : "Mark as DONE"}
          aria-label="Toggle done"
        />

        {/* Marker badge: click to toggle TODO ↔ DOING */}
        {toggleMarker ? (
          <button
            type="button"
            className="todo-marker todo-marker--clickable"
            onClick={(e) => {
              e.stopPropagation();
              onChangeMarker?.(todo.uuid, toggleMarker);
            }}
            title={`Change to ${MARKER_LABELS[toggleMarker]}`}
          >
            {MARKER_LABELS[todo.marker]}
          </button>
        ) : (
          <span className="todo-marker">{MARKER_LABELS[todo.marker] ?? todo.marker}</span>
        )}

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
          onChangeMarker={onChangeMarker}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
