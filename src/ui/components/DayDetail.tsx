import type { TodoBlock } from "../types";
import { sortDayTodos, groupDayTodosByPriority } from "../logseq";

interface DayDetailProps {
  journalDay: number;
  todos: TodoBlock[];
  loading: boolean;
  onBack: () => void;
  onDelete: (blockUuid: string) => void;
  onChangeMarker: (blockUuid: string, marker: TodoBlock["marker"]) => void;
}

const MARKER_BADGE: Record<string, string> = {
  DOING: "DOING",
  TODO: "TODO",
  DONE: "DONE",
  NOW: "NOW",
  LATER: "LATER",
  WAITING: "WAITING",
};

export default function DayDetail({ journalDay, todos, loading, onBack, onDelete, onChangeMarker }: DayDetailProps) {
  if (loading) {
    return (
      <div className="day-detail">
        <div className="day-detail-header">
          <button type="button" className="day-detail-back" onClick={onBack}>← Back</button>
          <h2 className="day-detail-date">{formatDay(journalDay)}</h2>
        </div>
        <p className="todo-empty">Loading...</p>
      </div>
    );
  }

  const sorted = sortDayTodos(todos);
  const grouped = groupDayTodosByPriority(sorted);

  return (
    <div className="day-detail">
      <div className="day-detail-header">
        <button type="button" className="day-detail-back" onClick={onBack}>← Back</button>
        <h2 className="day-detail-date">{formatDay(journalDay)}</h2>
      </div>

      {grouped.length === 0 ? (
        <p className="todo-empty">No tasks for this day.</p>
      ) : (
        <div className="day-detail-sections">
          {grouped.map(([label, items]) => (
            <section key={label} className="day-priority-section">
              <h3 className="day-priority-heading">{label}</h3>
              <div className="day-todo-list">
                {items.map((todo) => (
                  <DayTodoCard key={todo.uuid} todo={todo} onDelete={onDelete} onChangeMarker={onChangeMarker} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DayTodoCard({ todo, onDelete, onChangeMarker, depth = 0 }: {
  todo: TodoBlock;
  onDelete: (uuid: string) => void;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  depth?: number;
}) {
  const indent = Math.min(depth, 8);
  const toggleMarker = todo.marker === "TODO" ? "DOING" : todo.marker === "DOING" ? "TODO" : null;
  return (
    <>
      <div
        className={`todo-card marker-${todo.marker.toLowerCase()} todo-card--deletable`}
        style={{ paddingLeft: `${12 + indent * 20}px` }}
        data-depth={indent}
      >
        <button
          type="button"
          className={`todo-checkbox${todo.marker === "DONE" ? " checked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onChangeMarker(todo.uuid, todo.marker === "DONE" ? "TODO" : "DONE");
          }}
          title={todo.marker === "DONE" ? "Mark as TODO" : "Mark as DONE"}
          aria-label="Toggle done"
        />

        {toggleMarker ? (
          <button
            type="button"
            className="todo-marker todo-marker--clickable"
            onClick={(e) => {
              e.stopPropagation();
              onChangeMarker(todo.uuid, toggleMarker);
            }}
            title={`Change to ${MARKER_BADGE[toggleMarker]}`}
          >
            {MARKER_BADGE[todo.marker]}
          </button>
        ) : (
          <span className="todo-marker">{MARKER_BADGE[todo.marker] ?? todo.marker}</span>
        )}
        <span className="todo-content">{todo.content}</span>
        {todo.duration && (
          <span className="todo-duration" title={`Time spent: ${todo.duration}`}>⏱ {todo.duration}</span>
        )}
        <button
          type="button"
          className="todo-delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(todo.uuid); }}
          title="Delete"
        >
          ✕
        </button>
      </div>
      {todo.children?.map((child) => (
        <DayTodoCard key={child.uuid} todo={child} onDelete={onDelete} onChangeMarker={onChangeMarker} depth={depth + 1} />
      ))}
    </>
  );
}

function formatDay(day: number): string {
  const s = String(day);
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return `${y}-${m}-${d} ${weekday}`;
}
