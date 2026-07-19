import type { TodoBlock } from "../types";

interface TodoCardProps {
  todo: TodoBlock;
  draggable: boolean;
}

const MARKER_LABELS: Record<string, string> = {
  TODO: "TODO",
  DOING: "DOING",
  NOW: "NOW",
  LATER: "LATER",
  WAITING: "WAITING",
};

export default function TodoCard({ todo, draggable }: TodoCardProps) {
  return (
    <div
      className={`todo-card marker-${todo.marker.toLowerCase()}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/plain", todo.uuid);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="todo-marker">{MARKER_LABELS[todo.marker] ?? todo.marker}</span>
      {todo.priority && <span className="todo-priority">[{todo.priority}]</span>}
      <span className="todo-content">{todo.content}</span>
    </div>
  );
}
