import { useState, useEffect } from "react";
import type { TodoBlock } from "../types";
import { queryPageTodosGroupedByTitle } from "../logseq";
import { deleteTodoWithRefs } from "../logseq";
import TodoCard from "./TodoCard";

interface PageDetailProps {
  pageName: string;
  onBack: () => void;
}

export default function PageDetail({ pageName, onBack }: PageDetailProps) {
  const [groups, setGroups] = useState<Array<{ title: string; todos: TodoBlock[] }>>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await queryPageTodosGroupedByTitle(pageName);
      setGroups(result);
    } catch (err) {
      console.error("Failed to load page:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [pageName]);

  const handleDelete = async (uuid: string) => {
    await deleteTodoWithRefs(uuid);
    await load();
  };

  if (loading) {
    return (
      <div className="page-detail">
        <button type="button" className="day-detail-back" onClick={onBack}>← Back</button>
        <p className="todo-empty">Loading...</p>
      </div>
    );
  }

  return (
    <div className="page-detail">
      <div className="day-detail-header">
        <button type="button" className="day-detail-back" onClick={onBack}>← Back</button>
        <h2 className="day-detail-date">{pageName}</h2>
      </div>

      {groups.length === 0 ? (
        <p className="todo-empty">No TODOs on this page.</p>
      ) : (
        <div className="day-detail-sections">
          {groups.map(({ title, todos }) => (
            <section key={title || "__uncat__"} className="day-priority-section">
              <h3 className="day-priority-heading">{title || "Uncategorized"}</h3>
              <div className="day-todo-list">
                {todos.map((todo) => (
                  <TodoCard key={todo.uuid} todo={todo} draggable onDelete={handleDelete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
