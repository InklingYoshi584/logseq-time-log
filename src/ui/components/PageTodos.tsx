import type { TodoBlock } from "../types";
import TodoCard from "./TodoCard";

interface PageTodosProps {
  todos: TodoBlock[];
  loading: boolean;
  error: string | null;
  onDelete?: (uuid: string) => void;
  onSelectPage?: (pageName: string) => void;
}

export default function PageTodos({ todos, loading, error, onDelete, onSelectPage }: PageTodosProps) {
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
        <p className="todo-empty">No TODOs in regular pages.</p>
      </div>
    );
  }

  const grouped = groupByPage(todos);

  return (
    <div className="todo-list page-list">
      {grouped.map(([pageName, pageTodos]) => (
        <button
          key={pageName}
          type="button"
          className="page-card"
          onClick={() => onSelectPage?.(pageName)}
        >
          <div className="page-card-header">
            <span className="page-card-name">{pageName}</span>
            <span className="page-card-count">{pageTodos.length} TODO{pageTodos.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="page-card-preview">
            {pageTodos.slice(0, 3).map((todo) => (
              <TodoCard key={todo.uuid} todo={todo} draggable={false} />
            ))}
            {pageTodos.length > 3 && (
              <p className="page-card-more">+{pageTodos.length - 3} more</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function groupByPage(todos: TodoBlock[]): Array<[string, TodoBlock[]]> {
  const map = new Map<string, TodoBlock[]>();
  for (const t of todos) {
    const name = t.page.name;
    const group = map.get(name);
    if (group) {
      group.push(t);
    } else {
      map.set(name, [t]);
    }
  }
  return [...map.entries()];
}
