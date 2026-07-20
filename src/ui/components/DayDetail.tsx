import type { TodoBlock } from "../types";
import { sortDayTodos, groupDayTodosByPriority } from "../logseq";

interface DayDetailProps {
  journalDay: number;
  todos: TodoBlock[];
  loading: boolean;
  onBack: () => void;
  onDelete: (blockUuid: string) => void;
}

const MARKER_BADGE: Record<string, string> = {
  DOING: "DOING",
  TODO: "TODO",
  DONE: "DONE",
  NOW: "NOW",
  LATER: "LATER",
  WAITING: "WAITING",
};

export default function DayDetail({ journalDay, todos, loading, onBack, onDelete }: DayDetailProps) {
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
                  <DayTodoCard key={todo.uuid} todo={todo} onDelete={onDelete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DayTodoCard({ todo, onDelete }: { todo: TodoBlock; onDelete: (uuid: string) => void }) {
  return (
    <div className={`todo-card marker-${todo.marker.toLowerCase()} todo-card--deletable`}>
      <span className="todo-marker">{MARKER_BADGE[todo.marker] ?? todo.marker}</span>
      <span className="todo-content">{todo.content}</span>
      <button
        type="button"
        className="todo-delete-btn"
        onClick={(e) => { e.stopPropagation(); onDelete(todo.uuid); }}
        title="Delete"
      >
        ✕
      </button>
    </div>
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
