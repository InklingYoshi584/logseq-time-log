import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";

interface QuickCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, todoUuid?: string) => void;
  dayTodos: Array<{ uuid: string; content: string }>;
}

function cleanContent(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/:\s*LOGBOOK\s*:[\s\S]*?:\s*END\s*:/gi, "").replace(/\s*\w+::\s*\S+/g, "").trim();
  s = s.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i, "");
  s = s.replace(/^\[#(A|B|C)\]\s*/i, "");
  return s;
}

export default function QuickCreateDialog({ open, onClose, onCreate, dayTodos }: QuickCreateDialogProps) {
  const [name, setName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTodo, setSelectedTodo] = useState<string | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setSearchQuery("");
      setSelectedTodo(undefined);
    }
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => nameRef.current?.focus());
  }, [open]);

  const filteredTodos = dayTodos
    .filter((t) => searchQuery && cleanContent(t.content).toLowerCase().includes(searchQuery.toLowerCase()))
    .slice(0, 20);

  const canCreate = name.trim() || selectedTodo;

  const handleCreate = useCallback(() => {
    if (!canCreate) return;
    onCreate(name.trim() || (selectedTodo ? cleanContent(dayTodos.find((t) => t.uuid === selectedTodo)?.content) : ""), selectedTodo);
    onClose();
  }, [name, selectedTodo, onCreate, onClose, canCreate, dayTodos]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
    },
    [onClose, handleCreate]
  );

  if (!open) return null;

  return (
    <div className="time-create-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="time-create-modal time-create-quick-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3>New Entry</h3>

        <input
          ref={nameRef}
          className="time-create-modal-input"
          type="text"
          placeholder="Activity name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {selectedTodo ? (
          <p className="time-create-modal-linked">
            Linked: {cleanContent(dayTodos.find((t) => t.uuid === selectedTodo)?.content)}
            <button className="time-create-modal-unlink" onClick={() => setSelectedTodo(undefined)} title="Unlink">✕</button>
          </p>
        ) : (
          <>
            <input
              className="time-create-modal-search"
              type="text"
              placeholder="Search TODOs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && filteredTodos.length > 0 && (
              <ul className="time-create-modal-todos">
                {filteredTodos.map((todo) => {
                  const isSel = selectedTodo === todo.uuid;
                  return (
                    <li
                      key={todo.uuid}
                      className={"time-create-modal-todo-item" + (isSel ? " time-create-modal-todo-item--selected" : "")}
                      onClick={() => setSelectedTodo(isSel ? undefined : todo.uuid)}
                    >
                      {cleanContent(todo.content)}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div className="time-create-modal-actions">
          <button className="time-create-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="time-create-modal-create" disabled={!canCreate} onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
