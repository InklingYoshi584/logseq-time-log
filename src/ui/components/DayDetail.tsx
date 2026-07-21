import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TodoBlock, TodoPriority } from "../types";
import {
  groupDayTodosByPriority,
  findOrphanTodos,
  sweepToTodo,
} from "../logseq";
import AddTodoBar from "./AddTodoBar";

interface DayDetailProps {
  journalDay: number;
  pageName: string;
  todos: TodoBlock[];
  loading: boolean;
  onBack: () => void;
  onDelete: (blockUuid: string) => void;
  onChangeMarker: (blockUuid: string, marker: TodoBlock["marker"]) => void;
  onAddTodo: (text: string, priority: string) => void;
  onRefresh: () => void;
  onEdit: (blockUuid: string, newContent: string) => void;
  onReorder: (activeUuid: string, overUuid: string) => void;
  onChangePriority: (blockUuid: string, priority: TodoPriority | null) => void;
  readOnly?: boolean;
}

const MARKER_BADGE: Record<string, string> = {
  DOING: "DOING", TODO: "TODO", DONE: "DONE",
  NOW: "NOW", LATER: "LATER", WAITING: "WAITING",
};

const ALL_PRIORITY_KEYS = ["", "A", "B", "C"] as const;
const PRIORITY_LABELS: Record<string, string> = {
  "": "No priority", "A": "Priority A", "B": "Priority B", "C": "Priority C",
};

function priorityFromKey(key: string): TodoPriority | null {
  return key === "A" || key === "B" || key === "C" ? key : null;
}

export default function DayDetail({
  journalDay, pageName, todos, loading, onBack, onDelete,
  onChangeMarker, onAddTodo, onRefresh, onReorder, onChangePriority, onEdit, readOnly = false,
}: DayDetailProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => groupDayTodosByPriority(todos), [todos]);

  const sections = useMemo(() => {
    const map = new Map<string, TodoBlock[]>();
    for (const [key, items] of grouped) {
      map.set(key === "No priority" ? "" : key.replace("Priority ", ""), items);
    }
    return map;
  }, [grouped]);

  const orderedKeys = useMemo(() => {
    return [...ALL_PRIORITY_KEYS].sort((a, b) => {
      const aEmpty = (sections.get(a)?.length ?? 0) === 0;
      const bEmpty = (sections.get(b)?.length ?? 0) === 0;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      return ALL_PRIORITY_KEYS.indexOf(a) - ALL_PRIORITY_KEYS.indexOf(b);
    });
  }, [sections]);

  const [sweepOpen, setSweepOpen] = useState(false);
  const [orphans, setOrphans] = useState<TodoBlock[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overPriority, setOverPriority] = useState<string | null>(null);

  const activeTodo = useMemo(
    () => (activeId ? todos.find((t) => t.uuid === activeId) ?? null : null),
    [activeId, todos]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = String(event.over?.id);
    if (ALL_PRIORITY_KEYS.includes(overId as typeof ALL_PRIORITY_KEYS[number])) {
      setOverPriority(overId);
    } else {
      for (const [key, items] of sections) {
        if (items.some((t) => t.uuid === overId)) {
          setOverPriority(key);
          break;
        }
      }
    }
  }, [sections]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverPriority(null);
    if (!over) return;

    const activeUuid = String(active.id);
    const overId = String(over.id);

    // Dropping onto a priority section (empty drop zone)
    if (ALL_PRIORITY_KEYS.includes(overId as typeof ALL_PRIORITY_KEYS[number])) {
      const targetPriority = priorityFromKey(overId);
      const currentPriority = activeTodo?.priority ?? null;
      if (targetPriority !== currentPriority) {
        onChangePriority(activeUuid, targetPriority);
      }
      return;
    }

    const activeSection = findSectionFor(sections, activeUuid);
    const overSection = findSectionFor(sections, overId);

    if (activeSection === overSection && activeUuid !== overId) {
      console.log("[time-log] reorder within", activeSection, activeUuid, "→", overId);
      onReorder(activeUuid, overId);
    } else if (activeSection !== overSection && overSection) {
      console.log("[time-log] cross-section drop", activeSection, "→", overSection);
      const targetPriority = priorityFromKey(overSection);
      onChangePriority(activeUuid, targetPriority);
    }
  }, [sections, activeTodo, onChangePriority, onReorder]);

  const handleOpenSweep = async () => {
    const result = await findOrphanTodos(pageName);
    setOrphans(result);
    setSweepOpen(true);
  };

  const handleSweep = async (uuid: string) => {
    await sweepToTodo(pageName, uuid);
    setOrphans((prev) => prev.filter((o) => o.uuid !== uuid));
    onRefresh();
  };

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

  return (
    <div className="day-detail">
      <div className="day-detail-header">
        <button type="button" className="day-detail-back" onClick={onBack}>← Back</button>
        <h2 className="day-detail-date">{formatDay(journalDay)}</h2>
      </div>

      {!readOnly && <div className="add-todo-row">
        <AddTodoBar onAdd={onAddTodo} />
        <div className="add-todo-divider" />
        <div className="sweep-bar">
          <button type="button" className="sweep-btn" onClick={handleOpenSweep} title="Sweep orphan TODOs under # Todo">
            🧹
          </button>
        </div>
      </div>}
      {sweepOpen && (
        <div className="sweep-popup">
          <div className="sweep-popup-header">
            <span>Orphan TODOs</span>
            <button type="button" className="sweep-close" onClick={() => setSweepOpen(false)}>✕</button>
          </div>
          {orphans.length === 0 ? (
            <p className="sweep-empty">No orphan TODOs found.</p>
          ) : (
            orphans.map((o) => (
              <button key={o.uuid} type="button" className="sweep-item" onClick={() => handleSweep(o.uuid)}>
                <span className={`todo-marker marker-${o.marker.toLowerCase()}`}>{o.marker}</span>
                <span>{o.content}</span>
              </button>
            ))
          )}
        </div>
      )}

      {!readOnly ? (<DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="day-detail-sections">
          {orderedKeys.map((key) => {
            const items = sections.get(key) ?? [];
            const isEmpty = items.length === 0;
            const isOver = overPriority === key;

            return (
              <PrioritySection
                key={key}
                priorityKey={key}
                label={PRIORITY_LABELS[key]}
                items={items}
                isEmpty={isEmpty}
                isOver={isOver}
                isDragging={activeId !== null}
                onDelete={onDelete}
                onChangeMarker={onChangeMarker}
                onEdit={onEdit}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeTodo ? (
            <div className={`todo-card todo-card--overlay marker-${activeTodo.marker.toLowerCase()}`}>
              <span className="todo-marker">{MARKER_BADGE[activeTodo.marker]}</span>
              <span className="todo-content">{activeTodo.content}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>) : (
        <div className="day-detail-sections">
          {orderedKeys.map((key) => {
            const items = sections.get(key) ?? [];
            const isEmpty = items.length === 0;

            return (
              <section className="day-priority-section" data-priority={key}>
                <h3 className="day-priority-heading">{PRIORITY_LABELS[key]}</h3>
                {isEmpty ? null : (
                  <div className="day-todo-list">
                    {items.map((todo) => (
                      <DraggableTodoCard key={todo.uuid} todo={todo} onChangeMarker={onChangeMarker} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Priority Section ── */

function PrioritySection({
  priorityKey, label, items, isEmpty, isOver, isDragging,
  onDelete, onChangeMarker, onEdit,
}: {
  priorityKey: string; label: string; items: TodoBlock[];
  isEmpty: boolean; isOver: boolean; isDragging: boolean;
  onDelete: (uuid: string) => void;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  onEdit: (uuid: string, content: string) => void;
}) {
  const { setNodeRef: setDroppableRef } = useDroppable({ id: priorityKey });

  if (isEmpty && !isDragging) return null;

  return (
    <section
      ref={setDroppableRef}
      className={`day-priority-section${isOver ? " drop-target-active" : ""}`}
      data-priority={priorityKey}
    >
      <h3 className="day-priority-heading">{label}</h3>
      <SortableContext items={items.map((t) => t.uuid)} strategy={verticalListSortingStrategy}>
        <div className={`day-todo-list${isEmpty ? " drop-zone-empty" : ""}`}>
          {items.map((todo) => (
            <SortableTodoCard
              key={todo.uuid}
              todo={todo}
              onDelete={onDelete}
              onChangeMarker={onChangeMarker}
              onEdit={onEdit}
            />
          ))}
          {isEmpty && <div className="drop-zone-placeholder">Drop here</div>}
        </div>
      </SortableContext>
    </section>
  );
}

/* ── Sortable Todo Card ── */

function SortableTodoCard({ todo, onDelete, onChangeMarker, onEdit, depth = 0 }: {
  todo: TodoBlock;
  onDelete: (uuid: string) => void;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  onEdit: (uuid: string, content: string) => void;
  depth?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.uuid });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const toggleMarker = todo.marker === "TODO" ? "DOING" : todo.marker === "DOING" ? "TODO" : null;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.content);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={`todo-card marker-${todo.marker.toLowerCase()} todo-card--deletable`}
        style={{ paddingLeft: `${12 + Math.min(depth, 8) * 20}px` }}
        data-depth={Math.min(depth, 8)}
      >
        {editing ? (
          <input
            type="text"
            className="todo-edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onEdit(todo.uuid, editText);
                setEditing(false);
              } else if (e.key === "Escape") {
                setEditing(false);
                setEditText(todo.content);
              }
            }}
            onBlur={() => {
              onEdit(todo.uuid, editText);
              setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <>
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
              <span className="todo-marker">{MARKER_BADGE[todo.marker]}</span>
            )}
            <span className="todo-content">{todo.content}</span>
            {todo.duration && (
              <span className="todo-duration" title={`Time spent: ${todo.duration}`}>⏱ {todo.duration}</span>
            )}
            <button
              type="button"
              className="todo-edit-btn"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              title="Edit"
            >
              ✎
            </button>
            <button
              type="button"
              className="todo-delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(todo.uuid); }}
              title="Delete"
            >
              ✕
            </button>
          </>
        )}
      </div>
      {todo.children?.map((child) => (
        <SortableTodoCard key={child.uuid} todo={child} onDelete={onDelete} onChangeMarker={onChangeMarker} onEdit={onEdit} depth={depth + 1} />
      ))}
    </div>
  );
}

/* ── Draggable Todo Card (read-only) ── */

function DraggableTodoCard({ todo, onChangeMarker, depth = 0 }: {
  todo: TodoBlock;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  depth?: number;
}) {
  const toggleMarker = todo.marker === "TODO" ? "DOING" : todo.marker === "DOING" ? "TODO" : null;

  return (
    <>
      <div
        className={`todo-card marker-${todo.marker.toLowerCase()}`}
        style={{ paddingLeft: `${12 + Math.min(depth, 8) * 20}px`, cursor: "grab" }}
        data-depth={Math.min(depth, 8)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ uuid: todo.uuid, content: todo.content }));
          e.dataTransfer.effectAllowed = "copy";
          const img = document.createElement("div");
          img.style.cssText = "padding:6px 12px;background:var(--ls-accent,#60a5fa);color:#fff;border-radius:4px;font-size:14px;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:nowrap;position:fixed;top:-1000px;left:-1000px";
          img.textContent = todo.content || "Task";
          document.body.appendChild(img);
          e.dataTransfer.setDragImage(img, 0, 0);
          setTimeout(() => document.body.removeChild(img), 0);
        }}
      >
        <span className="todo-drag-handle">⋮⋮</span>
        <button type="button"
          className={`todo-checkbox${todo.marker === "DONE" ? " checked" : ""}`}
          onClick={(e) => { e.stopPropagation(); onChangeMarker(todo.uuid, todo.marker === "DONE" ? "TODO" : "DONE"); }}
          title={todo.marker === "DONE" ? "Mark as TODO" : "Mark as DONE"}
          aria-label="Toggle done" />
        {toggleMarker ? (
          <button type="button" className="todo-marker todo-marker--clickable"
            onClick={(e) => { e.stopPropagation(); onChangeMarker(todo.uuid, toggleMarker); }}
            title={`Change to ${MARKER_BADGE[toggleMarker]}`}>
            {MARKER_BADGE[todo.marker]}
          </button>
        ) : (
          <span className="todo-marker">{MARKER_BADGE[todo.marker]}</span>
        )}
        <span className="todo-content">{todo.content}</span>
        {todo.duration && (
          <span className="todo-duration" title={`Time spent: ${todo.duration}`}>⏱ {todo.duration}</span>
        )}
      </div>
      {todo.children?.map((child) => (
        <DraggableTodoCard key={child.uuid} todo={child} onChangeMarker={onChangeMarker} depth={depth + 1} />
      ))}
    </>
  );
}

/* ── Helpers ── */

function findSectionFor(sections: Map<string, TodoBlock[]>, uuid: string): string | null {
  for (const [key, items] of sections) {
    if (items.some((t) => t.uuid === uuid)) return key;
  }
  return null;
}

function formatDay(day: number): string {
  const s = String(day);
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return `${y} -${m} -${d} ${weekday} `;
}

