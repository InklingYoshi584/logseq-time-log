import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";

interface QuickCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, todoUuid?: string) => void;
  dayTodos: Array<{ uuid: string; content: string }>;
}

/** Strip block properties like `id:: uuid` from display content. */
function cleanContent(raw: string | null | undefined): string {
  if (!raw) return "";
  // Strip :LOGBOOK: ... :END: drawer
  let s = raw.replace(/:\s*LOGBOOK\s*:[\s\S]*?:\s*END\s*:/gi, "").replace(/\s*\w+::\s*\S+/g, "").trim();
  // Strip marker prefix (TODO, DOING, DONE, NOW, LATER, WAITING)
  s = s.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i, "");
  // Strip priority tag [#A], [#B], [#C]
  s = s.replace(/^\[#(A|B|C)\]\s*/i, "");
  return s;
}

export default function QuickCreateDialog({ open, onClose, onCreate, dayTodos }: QuickCreateDialogProps) {
  const [name, setName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTodo, setSelectedTodo] = useState<string | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);
  const prevOpenRef = useRef(open);

  // Reset state whenever `open` changes (both open→close and close→open)
  useEffect(() => {
    if (open !== prevOpenRef.current) {
      prevOpenRef.current = open;
      if (open) {
        setName("");
        setSearchQuery("");
        setSelectedTodo(undefined);
      }
    }
  }, [open]);

  // Focus the name input when the dialog opens
  useEffect(() => {
    if (open && nameRef.current) {
      nameRef.current.focus();
    }
  }, [open]);

  const filteredTodos = dayTodos
    .filter((t) => searchQuery && cleanContent(t.content).toLowerCase().includes(searchQuery.toLowerCase()))
    .slice(0, 20);

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, selectedTodo);
    onClose();
  }, [name, selectedTodo, onCreate, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleCreate();
      }
    },
    [onClose, handleCreate]
  );

  if (!open) return null;

  return (
    <div className="time-create-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="time-create-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
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
          <p>Linked: {cleanContent(dayTodos.find((t) => t.uuid === selectedTodo)?.content)}</p>
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
                      className={
                        "time-create-modal-todo-item" +
                        (isSel ? " time-create-modal-todo-item--selected" : "")
                      }
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

        <div className="time-create-modal-buttons">
          <button className="time-create-modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="time-create-modal-create" disabled={!name.trim()} onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
