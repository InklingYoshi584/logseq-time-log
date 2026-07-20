import { useState, useMemo } from "react";
import type { TodoBlock } from "../types";
import TodoCard from "./TodoCard";
import SearchBar, { type SearchMode } from "./SearchBar";

interface PageTodosProps {
  todos: TodoBlock[];
  loading: boolean;
  error: string | null;
  onDelete?: (uuid: string) => void;
  onSelectPage?: (pageName: string) => void;
  onChangeMarker?: (uuid: string, marker: string) => void;
}

export default function PageTodos({ todos, loading, error, onDelete, onSelectPage, onChangeMarker }: PageTodosProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("active");

  const filtered = useMemo(() => {
    let list = todos;

    // Filter by mode
    if (searchMode === "active") {
      list = list.filter((t) => t.marker !== "DONE");
    }

    // Filter by query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (searchMode === "pages") {
        list = list.filter((t) => t.page.name.toLowerCase().includes(q));
      } else {
        list = list.filter((t) => t.content.toLowerCase().includes(q));
      }
    }

    return list;
  }, [todos, searchQuery, searchMode]);

  const grouped = useMemo(() => groupByPage(filtered), [filtered]);

  const handleSearch = (query: string, mode: SearchMode) => {
    setSearchQuery(query);
    setSearchMode(mode);
  };

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

  return (
    <div className="misc-panel">
      <SearchBar onSearch={handleSearch} />
      <div className="todo-list page-list">
        {filtered.length === 0 ? (
          <p className="todo-empty">
            {searchQuery.trim()
              ? searchMode === "pages" ? "No matching pages." : "No matching TODOs."
              : "No TODOs in regular pages."}
          </p>
        ) : searchQuery.trim() && searchMode !== "pages" ? (
          // Search mode: flat list with page name separators
          grouped.map(([pageName, pageTodos]) => (
            <section key={pageName} className="todo-page-group">
              <h3 className="todo-page-heading">{pageName}</h3>
              {pageTodos.map((todo) => (
                <TodoCard key={todo.uuid} todo={todo} draggable onDelete={onDelete} onChangeMarker={onChangeMarker} />
              ))}
            </section>
          ))
        ) : searchQuery.trim() && searchMode === "pages" ? (
          // Page search: show page cards
          grouped.map(([pageName, pageTodos]) => (
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
                  <TodoCard key={todo.uuid} todo={todo} draggable={false} onChangeMarker={onChangeMarker} />
                ))}
                {pageTodos.length > 3 && (
                  <p className="page-card-more">+{pageTodos.length - 3} more</p>
                )}
              </div>
            </button>
          ))
        ) : (
          // Browse mode: page cards
          grouped.map(([pageName, pageTodos]) => (
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
                  <TodoCard key={todo.uuid} todo={todo} draggable={false} onChangeMarker={onChangeMarker} />
                ))}
                {pageTodos.length > 3 && (
                  <p className="page-card-more">+{pageTodos.length - 3} more</p>
                )}
              </div>
            </button>
          ))
        )}
      </div>
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
