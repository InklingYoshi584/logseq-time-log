import type { TodoBlock } from "../types";
import TodoCard from "./TodoCard";

interface PageTodosProps {
  todos: TodoBlock[];
  loading: boolean;
  error: string | null;
  onDelete?: (uuid: string) => void;
}

export default function PageTodos({ todos, loading, error, onDelete }: PageTodosProps) {
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
    <div className="todo-list">
      {grouped.map(([pageName, pageTodos]) => (
        <section key={pageName} className="todo-page-group">
          <h3 className="todo-page-heading">{pageName}</h3>
          {pageTodos.map((todo) => (
            <TodoCard key={todo.uuid} todo={todo} draggable onDelete={onDelete} />
          ))}
        </section>
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
