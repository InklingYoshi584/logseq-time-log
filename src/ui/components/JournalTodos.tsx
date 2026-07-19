import type { TodoBlock } from "../types";
import TodoCard from "./TodoCard";

interface JournalTodosProps {
  todos: TodoBlock[];
  loading: boolean;
  error: string | null;
  onDropTodo: (uuid: string) => void;
}

export default function JournalTodos({ todos, loading, error, onDropTodo }: JournalTodosProps) {
  if (error) {
    return (
      <div className="todo-list">
        <p className="todo-empty todo-error">{error}</p>
        <p className="todo-hint">Check the browser console for details.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="todo-list"><p className="todo-empty">Loading...</p></div>;
  }

  if (todos.length === 0) {
    return (
      <div className="todo-list">
        <p className="todo-empty">No TODOs in journal pages.</p>
        <p className="todo-hint">Drag TODOs from Page TODOs here to move them to your journal.</p>
      </div>
    );
  }

  const grouped = groupByDay(todos);

  return (
    <div
      className="todo-list"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const uuid = e.dataTransfer.getData("text/plain");
        if (uuid) onDropTodo(uuid);
      }}
    >
      {grouped.map(([day, dayTodos]) => (
        <section key={day} className="todo-day-group">
          <h3 className="todo-day-heading">{formatJournalDay(day)}</h3>
          {dayTodos.map((todo) => (
            <TodoCard key={todo.uuid} todo={todo} draggable={false} />
          ))}
        </section>
      ))}
    </div>
  );
}

function groupByDay(todos: TodoBlock[]): Array<[string, TodoBlock[]]> {
  const map = new Map<string, TodoBlock[]>();
  for (const t of todos) {
    const day = t.page.journalDay ? String(t.page.journalDay) : t.page.name;
    const group = map.get(day);
    if (group) {
      group.push(t);
    } else {
      map.set(day, [t]);
    }
  }
  return [...map.entries()];
}

function formatJournalDay(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return raw;
}
