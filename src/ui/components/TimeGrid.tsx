import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { TimeLogEntry } from "../types";
import TimeBlock from "./TimeBlock";
import HourMarkers from "./HourMarkers";
import CurrentTimeLine from "./CurrentTimeLine";

interface TimeGridProps {
 entries: TimeLogEntry[];
 hourHeight: number;
 resizeState?: { uuid: string; type: "top" | "bottom"; minutes: number } | null;
 createState?: { startMinutes: number; endMinutes: number } | null;
 moveState?: { uuid: string; startMinutes: number } | null;
 selectedBlockUuid: string | null;
 onSelectBlock: (uuid: string | null) => void;
 onDoubleClickBlock: (uuid: string) => void;
 onDeleteBlock: (uuid: string) => void;
 onDropTodo?: (uuid: string, startMinutes: number) => void;
 onDragOverGrid?: (minutes: number | null) => void;
 nativeDragState?: { uuid: string; content: string; startMinutes: number | null } | null;
}

// Width of the hour marker column — must match .time-grid-markers in App.css
const MARKER_WIDTH = 54;

const HOURS_PER_DAY = 24;
const MIN_BLOCK_HEIGHT = 2;
const BLOCK_Z_INDEX = 2;

function formatHM(minutes: number): string {
 return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

interface LayoutItem {
 entry: TimeLogEntry;
 column: number;
 totalColumns: number;
}

/**
 * Compute overlap column layout for time entries.
 *
 * 1. Sort entries by startMinutes
 * 2. Greedy column assignment: for each entry, find columns
 *    occupied by overlapping prior entries and take the first free column
 * 3. Find connected components (transitive overlap closure) to determine
 *    totalColumns per group
 */
function computeLayout(entries: TimeLogEntry[]): LayoutItem[] {
 if (entries.length === 0) return [];

 const sorted = [...entries].sort((a, b) => a.startMinutes - b.startMinutes);

 // ── Greedy column assignment ──
 const columnMap = new Map<string, number>();

 for (const entry of sorted) {
  const usedCols = new Set<number>();
  // Check all prior entries for overlap
  for (const prev of sorted) {
   if (prev.uuid === entry.uuid) break;
   if (prev.endMinutes > entry.startMinutes) {
    usedCols.add(columnMap.get(prev.uuid)!);
   }
  }
  let col = 0;
  while (usedCols.has(col)) col++;
  columnMap.set(entry.uuid, col);
 }

 // ── Find connected components (overlap groups) ──
 // Adjacency: two entries overlap if a.start < b.end AND b.start < a.end
 const adj = new Map<string, string[]>();
 for (const a of sorted) {
  const neighbors: string[] = [];
  for (const b of sorted) {
   if (a.uuid === b.uuid) continue;
   if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
    neighbors.push(b.uuid);
   }
  }
  adj.set(a.uuid, neighbors);
 }

 const visited = new Set<string>();
 const groupMap = new Map<string, number>();

 for (const entry of sorted) {
  if (visited.has(entry.uuid)) continue;

  // DFS to collect the component
  const group: string[] = [];
  const stack = [entry.uuid];
  while (stack.length > 0) {
   const uuid = stack.pop()!;
   if (visited.has(uuid)) continue;
   visited.add(uuid);
   group.push(uuid);
   for (const neighbor of adj.get(uuid) || []) {
    if (!visited.has(neighbor)) stack.push(neighbor);
   }
  }

  let maxCol = 0;
  for (const uuid of group) {
   const col = columnMap.get(uuid)!;
   if (col > maxCol) maxCol = col;
  }
  const total = maxCol + 1;
  for (const uuid of group) {
   groupMap.set(uuid, total);
  }
 }

 return sorted.map((entry) => ({
  entry,
  column: columnMap.get(entry.uuid)!,
  totalColumns: groupMap.get(entry.uuid)!,
 }));
}

export default function TimeGrid({
 entries,
 hourHeight,
 resizeState,
 createState,
 moveState,
 selectedBlockUuid,
 onSelectBlock,
 onDoubleClickBlock,
 onDeleteBlock,
 onDropTodo,
 onDragOverGrid,
 nativeDragState,
}: TimeGridProps) {
 const gridContainerRef = useRef<HTMLDivElement>(null);
 const dragLeaveTimer = useRef<ReturnType<typeof setTimeout>>();

 // ── Droppable zone for journal-todo drops ──
 const { setNodeRef: setDroppableRef, isOver } = useDroppable({
  id: "time-grid-zone",
 });

 // ── Create overlay draggable for click-drag-to-create ──
 const {
  setNodeRef: setOverlayRef,
  listeners: overlayListeners,
  attributes: overlayAttrs,
 } = useDraggable({
  id: "time-grid-overlay",
  data: { type: "create-selection" },
 });

 // ── Current time line ──
 const [nowMinutes, setNowMinutes] = useState<number>(() => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
 });

 useEffect(() => {
  const tick = () => {
   const now = new Date();
   setNowMinutes(now.getHours() * 60 + now.getMinutes());
  };
  const id = setInterval(tick, 60000);
  return () => clearInterval(id);
 }, []);

 const currentTimeTop = (nowMinutes / 60) * hourHeight;

 // ── Keyboard shortcuts ──
 useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
   if (e.key === "Escape") {
    onSelectBlock(null);
   } else if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedBlockUuid) {
     onDeleteBlock(selectedBlockUuid);
    }
   }
  }
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
 }, [onSelectBlock, onDeleteBlock, selectedBlockUuid]);

 // ── Block layout ──
 const layoutBlocks = useMemo(() => computeLayout(entries), [entries]);

 // ── Click on empty grid space to deselect ──
 const handleGridZoneClick = useCallback(
  (e: React.MouseEvent) => {
   // Debug: log computed time from click position
   const zoneRect = e.currentTarget.getBoundingClientRect();
   const parentScroll = (e.currentTarget as HTMLElement).closest('.time-grid-scroll');
   const scrollTop = parentScroll ? (parentScroll as HTMLElement).scrollTop : 0;
   const relativeY = e.clientY - zoneRect.top + scrollTop;
   const minutes = (relativeY / hourHeight) * 60;
   const snapped = Math.round(minutes / 5) * 5;
   console.log("[time-log] click at", {
    clientY: e.clientY,
    zoneTop: zoneRect.top,
    scrollTop,
    relativeY,
    hourHeight,
    minutes: minutes.toFixed(1),
    snapped,
    time: `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`,
   });
   if (e.target === e.currentTarget) {
    onSelectBlock(null);
   }
  },
  [onSelectBlock],
 );

 const totalHeight = HOURS_PER_DAY * hourHeight;

 return (
  <div
   className="time-grid"
   ref={gridContainerRef}
   onMouseDownCapture={(e) => {
    if (e.button !== 0) return;
    const gridRect = e.currentTarget.getBoundingClientRect();
    const scrollEl = (e.currentTarget as HTMLElement).closest('.time-grid-scroll') as HTMLElement | null;
    const st = scrollEl?.scrollTop ?? 0;
    const ry = e.clientY - gridRect.top + st;
    const mins = (ry / hourHeight) * 60;
    const snap = Math.round(mins / 5) * 5;
    console.log("[time-log] mousedown", JSON.stringify({
     clientY: e.clientY, gridTop: Math.round(gridRect.top), scrollTop: st,
     relativeY: Math.round(ry), hourHeight, minutes: mins.toFixed(1), snapped: snap,
     time: `${String(Math.floor(snap / 60)).padStart(2, "0")}:${String(snap % 60).padStart(2, "0")}`
    }));
   }}
   style={{ minHeight: totalHeight }}
  >
   <HourMarkers hourHeight={hourHeight} />
   <CurrentTimeLine top={currentTimeTop} label={formatHM(nowMinutes)} />

   <div
    className={`time-grid-zone${isOver ? " time-grid-zone--over" : ""}`}
    ref={setDroppableRef}
    onClick={handleGridZoneClick}
    onDragOver={(e) => {
     e.preventDefault();
     e.dataTransfer.dropEffect = "copy";
     // Hide native drag ghost — custom overlay takes over
     try {
      const blank = document.createElement("div");
      blank.id = "time-log-drag-blank";
      blank.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;opacity:0;pointer-events:none";
      // Remove any previous blank
      document.getElementById("time-log-drag-blank")?.remove();
      document.body.appendChild(blank);
      e.dataTransfer.setDragImage(blank, 0, 0);
      // Keep alive until drag ends
      setTimeout(() => document.getElementById("time-log-drag-blank")?.remove(), 5000);
     } catch { /* ignore */ }
     if (!onDragOverGrid) return;
     // Report snapped time position to parent for overlay
     const zoneRect = e.currentTarget.getBoundingClientRect();
     const parentScroll = e.currentTarget.closest('.time-grid-scroll');
     const scrollTop = parentScroll ? (parentScroll as HTMLElement).scrollTop : 0;
     const relativeY = e.clientY - zoneRect.top + scrollTop;
     const minutes = (relativeY / hourHeight) * 60;
     const snapped = Math.round(minutes / 5) * 5;
     onDragOverGrid(Math.max(0, Math.min(23 * 60 + 55, snapped)));
     // Clear any pending onDragLeave clear
     if (dragLeaveTimer.current) {
      clearTimeout(dragLeaveTimer.current);
      dragLeaveTimer.current = undefined;
     }
    }}
    onDragEnter={() => {
     // Cancel any pending onDragLeave clear when re-entering from child
     if (dragLeaveTimer.current) {
      clearTimeout(dragLeaveTimer.current);
      dragLeaveTimer.current = undefined;
     }
    }}
    onDragLeave={() => {
     // Defer clearing so child-element transitions don't flicker
     if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
     dragLeaveTimer.current = setTimeout(() => {
      onDragOverGrid?.(null);
     }, 0);
    }}
    onDrop={(e) => {
     e.preventDefault();
     try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (!data.uuid || !onDropTodo) return;
      const zoneRect = e.currentTarget.getBoundingClientRect();
      const parentScroll = e.currentTarget.closest('.time-grid-scroll');
      const scrollTop = parentScroll ? (parentScroll as HTMLElement).scrollTop : 0;
      const relativeY = e.clientY - zoneRect.top + scrollTop;
      const minutes = (relativeY / hourHeight) * 60;
      const snapped = Math.round(minutes / 5) * 5;
      const startMinutes = Math.max(0, Math.min(23 * 60 + 55, snapped));
      onDropTodo(data.uuid, startMinutes);
     } catch { /* ignore */ }
    }}
   >
    {layoutBlocks.map(({ entry, column, totalColumns }) => {
     let displayStart = entry.startMinutes;
     let displayEnd = entry.endMinutes;
     if (resizeState && resizeState.uuid === entry.uuid) {
      if (resizeState.type === "top") {
       displayStart = Math.max(0, Math.min(displayEnd - 5, resizeState.minutes));
      } else {
       displayEnd = Math.min(24 * 60, Math.max(displayStart + 5, resizeState.minutes));
      }
     }
     if (moveState && moveState.uuid === entry.uuid) {
      const duration = displayEnd - displayStart;
      displayStart = moveState.startMinutes;
      displayEnd = displayStart + duration;
     }
     const top = (displayStart / 60) * hourHeight;
     const height = Math.max(
      MIN_BLOCK_HEIGHT,
      Math.min(((displayEnd - displayStart) / 60) * hourHeight, 24 * hourHeight - top),
     );

     return (
      <TimeBlock
       key={entry.uuid}
       entry={entry}
       displayStart={resizeState?.uuid === entry.uuid ? displayStart : undefined}
       displayEnd={resizeState?.uuid === entry.uuid ? displayEnd : undefined}
       style={{
        position: "absolute",
        top,
        height,
        left: `${(column / totalColumns) * 100}%`,
        width: `${100 / totalColumns}%`,
        zIndex: BLOCK_Z_INDEX,
       }}
       isSelected={selectedBlockUuid === entry.uuid}
       onSelect={onSelectBlock}
       onDoubleClick={onDoubleClickBlock}
       onDelete={onDeleteBlock}
      />
     );
    })}

    {nativeDragState && nativeDragState.startMinutes !== null && (
     <div className="time-drag-overlay time-drag-overlay--block time-drag-overlay--task"
      style={{
       position: "absolute",
       top: (nativeDragState.startMinutes / 60) * hourHeight,
       height: Math.max(4, (25 / 60) * hourHeight),
       left: 0,
       right: 0,
       zIndex: 100,
       pointerEvents: "none",
      }}
     >
      <span className="time-drag-overlay-time">{formatHM(nativeDragState.startMinutes)} - {formatHM(Math.min(24 * 60, nativeDragState.startMinutes + 25))}</span>
      <span className="time-drag-overlay-activity">{nativeDragState.content}</span>
     </div>
    )}

    {createState && (
     <div className="time-block time-block--event"
      style={{
       position: "absolute",
       top: (createState.startMinutes / 60) * hourHeight,
       height: Math.max(2, ((createState.endMinutes - createState.startMinutes) / 60) * hourHeight),
       left: "2%",
       width: "96%",
       zIndex: 100,
       pointerEvents: "none",
       opacity: 0.75,
       borderStyle: "dashed",
      }}
     >
      <div className="time-block-body">
       <span className="time-block-time">{formatHM(createState.startMinutes)} - {formatHM(createState.endMinutes)}</span>
      </div>
     </div>
    )}
   </div>

   <div
    className="time-grid-create-overlay"
    style={nativeDragState ? { pointerEvents: "none" } : undefined}
    ref={setOverlayRef}
    {...overlayListeners}
    {...overlayAttrs}
   />
  </div>
 );
}
