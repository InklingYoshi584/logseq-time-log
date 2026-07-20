import { useState, useEffect, useCallback, useMemo } from "react";
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
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TodoBlock, TodoPriority } from "../types";
import {
  sortDayTodos,
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
  onReorder: (activeUuid: string, overUuid: string) => void;
  onChangePriority: (blockUuid: string, priority: TodoPriority | null) => void;
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
  onChangeMarker, onAddTodo, onRefresh, onReorder, onChangePriority,
}: DayDetailProps) {
  const [sweepOpen, setSweepOpen] = useState(false);
  const [orphans, setOrphans] = useState<TodoBlock[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overPriority, setOverPriority] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sorted = useMemo(() => sortDayTodos(todos), [todos]);
  const grouped = useMemo(() => groupDayTodosByPriority(sorted), [sorted]);

  // Build section map: priorityKey → TodoBlock[]
  const sections = useMemo(() => {
    const map = new Map<string, TodoBlock[]>();
    for (const [key, items] of grouped) {
      map.set(key === "No priority" ? "" : key.replace("Priority ", ""), items);
    }
    return map;
  }, [grouped]);

  const activeTodo = useMemo(
    () => (activeId ? todos.find((t) => t.uuid === activeId) ?? null : null),
    [activeId, todos]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = String(event.over?.id);
    // Check if over a priority section container
    if (ALL_PRIORITY_KEYS.includes(overId as typeof ALL_PRIORITY_KEYS[number])) {
      setOverPriority(overId);
    } else {
      // Check which section the over item belongs to
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

    // Check if dropping onto a priority section (empty drop zone)
    if (ALL_PRIORITY_KEYS.includes(overId as typeof ALL_PRIORITY_KEYS[number])) {
      const targetPriority = priorityFromKey(overId);
      const currentPriority = activeTodo?.priority ?? null;
      if (targetPriority !== currentPriority) {
        onChangePriority(activeUuid, targetPriority);
      }
      return;
    }

    // Dropping on another todo item
    const activeSection = findSectionFor(sections, activeUuid);
    const overSection = findSectionFor(sections, overId);

    if (activeSection === overSection && activeUuid !== overId) {
      // Same section → reorder
      onReorder(activeUuid, overId);
    } else if (activeSection !== overSection && overSection) {
      // Different section → change priority
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

      <div className="add-todo-row">
        <AddTodoBar onAdd={onAddTodo} />
        <div className="add-todo-divider" />
        <div className="sweep-bar">
          <button type="button" className="sweep-btn" onClick={handleOpenSweep} title="Sweep orphan TODOs under # Todo">
            🧹
          </button>
        </div>
      </div>
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="day-detail-sections">
          {ALL_PRIORITY_KEYS.map((key) => {
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
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeTodo ? (
            <div className="todo-card todo-card--overlay marker-${activeTodo.marker.toLowerCase()}">
              <span className="todo-marker">{MARKER_BADGE[activeTodo.marker]}</span>
              <span className="todo-content">{activeTodo.content}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/* ── Priority Section (drop target) ── */

function PrioritySection({
  priorityKey, label, items, isEmpty, isOver, isDragging,
  onDelete, onChangeMarker,
}: {
  priorityKey: string; label: string; items: TodoBlock[];
  isEmpty: boolean; isOver: boolean; isDragging: boolean;
  onDelete: (uuid: string) => void;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
}) {
  if (isEmpty && !isDragging) return null;

  const { setNodeRef: setDroppableRef, isOver: isDroppableOver } = useDroppable({ id: priorityKey });

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
            />
          ))}
          {isEmpty && <div className="drop-zone-placeholder">Drop here</div>}
        </div>
      </SortableContext>
    </section>
  );
}

/* ── Sortable Todo Card ── */

function SortableTodoCard({ todo, onDelete, onChangeMarker, depth = 0 }: {
  todo: TodoBlock;
  onDelete: (uuid: string) => void;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  depth?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.uuid });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const toggleMarker = todo.marker === "TODO" ? "DOING" : todo.marker === "DOING" ? "TODO" : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <div
        className={`todo-card marker-${todo.marker.toLowerCase()} todo-card--deletable`}
        style={{ paddingLeft: `${12 + Math.min(depth, 8) * 20}px` }}
        data-depth={Math.min(depth, 8)}
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
          <span className="todo-marker">{MARKER_BADGE[todo.marker]}</span>
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
        <SortableTodoCard key={child.uuid} todo={child} onDelete={onDelete} onChangeMarker={onChangeMarker} depth={depth + 1} />
      ))}
    </div>
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
  return `${y}-${m}-${d} ${weekday}`;
}
