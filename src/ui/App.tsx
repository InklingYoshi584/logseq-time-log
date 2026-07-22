import { useState, useEffect, useCallback } from "react";
import { useRef } from "react";
import {
 DndContext,
 DragOverlay,
 PointerSensor,
 useSensor,
 useSensors,
 pointerWithin,
} from "@dnd-kit/core";
import type { DragStartEvent, DragMoveEvent, DragEndEvent } from "@dnd-kit/core";
import type { TodoBlock, TodoPriority } from "./types";
import type { AppTab, TimeLogEntry, DragData } from "./types";
import {
 queryAllTodos,
 queryJournalDaysWithTodos,
 queryDayTodos,
 groupTodos,
 sortPageTodos,
 moveTodoToJournal,
 deleteJournalBlock,
 deleteTodoWithRefs,
 changeMarker,
 parseLogseqDate,
 resolveJournalPageName,
 findOrCreateTodosBlock,
} from "./logseq";
import {
 queryTimeLogEntries,
 findOrCreateTimeLogBlock,
 updateTimeLogEntry,
} from "./logseq";
import HeaderBar from "./components/HeaderBar";
import TimeLogView from "./components/TimeLogView";
import SplitView from "./components/SplitView";
import CalendarView from "./components/CalendarView";
import DayDetail from "./components/DayDetail";
import PageTodos from "./components/PageTodos";
import PageDetail from "./components/PageDetail";

const INITIAL_YEAR_WINDOW = 3;

function formatHM(minutes: number): string {
 return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function DragPreview({ data, overMinutes, hourHeight, entries, dragStartMinutes }: {
 data: DragData;
 overMinutes: number | null;
 hourHeight: number;
 entries: TimeLogEntry[];
 dragStartMinutes: number | null;
}) {
 const entry = data.uuid ? entries.find(e => e.uuid === data.uuid) : undefined;
 const cls = entry?.isClockEntry ? "time-drag-overlay--clock"
  : entry?.todoUuid ? "time-drag-overlay--task"
   : "time-drag-overlay--event";
 return null;
}

export default function App() {
 const [pageTodos, setPageTodos] = useState<TodoBlock[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 /* ── Calendar state ── */
 const currentYear = new Date().getFullYear();
 const [yearRange, setYearRange] = useState({ start: currentYear, end: currentYear });
 const [daysByYear, setDaysByYear] = useState<Map<number, Set<number>>>(new Map());
 const [selectedDay, setSelectedDay] = useState<number | null>(null);
 const [dayTodos, setDayTodos] = useState<TodoBlock[]>([]);
 const [dayLoading, setDayLoading] = useState(false);

 /* ── Misc state ── */
 const [selectedPage, setSelectedPage] = useState<string | null>(null);
 const [activeTab, setActiveTab] = useState<AppTab>("tasks");
 const [timeLogEntries, setTimeLogEntries] = useState<TimeLogEntry[]>([]);
 const [timeLogLoading, setTimeLogLoading] = useState(false);
 const [dragActiveData, setDragActiveData] = useState<DragData | null>(null);
 const [dragOverMinutes, setDragOverMinutes] = useState<number | null>(null);
 const dragOverRef = useRef<number | null>(null);
 const dragStartRef = useRef<number | null>(null);
 const dragStartPixelRef = useRef<number | null>(null);
 const [dragStartMinutes, setDragStartMinutes] = useState<number | null>(null);
 const [selectedBlockUuid, setSelectedBlockUuid] = useState<string | null>(null);
 const [createModalOpen, setCreateModalOpen] = useState(false);
 const [createModalRange, setCreateModalRange] = useState<{ start: number; end: number } | null>(null);
 const [createModalName, setCreateModalName] = useState("");
 const [timeLogHourHeight, setTimeLogHourHeight] = useState(60);
 const [resizeState, setResizeState] = useState<{ uuid: string; type: "top" | "bottom"; minutes: number } | null>(null);
 const [editingBlockUuid, setEditingBlockUuid] = useState<string | null>(null);
 const [createState, setCreateState] = useState<{ startMinutes: number; endMinutes: number } | null>(null);
 const [moveState, setMoveState] = useState<{ uuid: string; startMinutes: number } | null>(null);
 const [nativeDragState, setNativeDragState] = useState<{ uuid: string; content: string; startMinutes: number | null; shiftKey: boolean } | null>(null);
 const gridScrollRef = useRef<HTMLDivElement | null>(null);

 const handleClose = useCallback(() => {
  logseq.hideMainUI();
 }, []);

 useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
   if (e.key === "Escape") {
    if (selectedBlockUuid !== null) {
     setSelectedBlockUuid(null);
     return;
    }
    if (selectedDay !== null) {
     setSelectedDay(null);
    } else if (selectedPage !== null) {
     setSelectedPage(null);
    } else {
     handleClose();
    }
   }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
 }, [handleClose, selectedDay, selectedPage, selectedBlockUuid]);

 const timeLogSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

 /* ── Year loading ── */
 const loadYear = useCallback(async (year: number) => {
  const days = await queryJournalDaysWithTodos(year);
  setDaysByYear((prev) => {
   const next = new Map(prev);
   next.set(year, days);
   return next;
  });
 }, []);

 const expandUp = useCallback(() => {
  setYearRange((prev) => {
   const newStart = prev.start - 1;
   loadYear(newStart);
   return { start: newStart, end: prev.end };
  });
 }, [loadYear]);

 const expandDown = useCallback(() => {
  setYearRange((prev) => {
   const newEnd = prev.end + 1;
   loadYear(newEnd);
   return { start: prev.start, end: newEnd };
  });
 }, [loadYear]);

 /* ── Initial load ── */
 const initYears = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
   await loadYear(currentYear);
   const half = Math.floor(INITIAL_YEAR_WINDOW / 2);
   const start = currentYear - half;
   const end = currentYear + half;
   setYearRange({ start, end });
   const promises = [];
   for (let y = start; y <= end; y++) {
    if (y !== currentYear) promises.push(loadYear(y));
   }
   await Promise.all(promises);

   const pageResults = await queryAllTodos();
   const grouped = groupTodos(pageResults);
   setPageTodos(sortPageTodos(grouped.pages));

   // Auto-select today
   if (selectedDay === null) {
    console.log("[time-log] auto-selecting today...");
    try {
     const stateToday = await logseq.App.getStateFromStore("today") as unknown;
     console.log("[time-log] state today:", stateToday);
     const day = parseLogseqDate(stateToday);
     if (day) {
      console.log("[time-log] auto-selecting day:", day);
      setSelectedDay(day);
      setDayLoading(true);
      const todos = await queryDayTodos(day);
      setDayTodos(todos);
      setDayLoading(false);
     }
    } catch (err) {
     console.error("[time-log] auto-select failed:", err);
    }
   }
  } catch (err) {
   const msg = err instanceof Error ? err.message : String(err);
   console.error("Failed to load:", err);
   setError(msg);
  } finally {
   setLoading(false);
  }
 }, [currentYear, loadYear]);

 const handleRefresh = useCallback(async () => {
  await initYears();
  if (activeTab === "timelog" && selectedDay !== null) {
   const entries = await queryTimeLogEntries(selectedDay);
   setTimeLogEntries(entries);
  }
 }, [initYears, activeTab, selectedDay]);

 useEffect(() => {
  // eslint-disable-next-line -- initial load
  initYears();
 }, [initYears]);

 useEffect(() => {
  /* eslint-disable react-hooks/set-state-in-effect */
  if (activeTab === "timelog") {
   if (selectedDay !== null) {
    setTimeLogLoading(true);
    setSelectedBlockUuid(null);
    queryTimeLogEntries(selectedDay).then(setTimeLogEntries).finally(() => setTimeLogLoading(false));
   } else {
    // Auto-select today when switching to Time Log tab with no day selected
    const now = new Date();
    const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    handleSelectDay(today);
   }
  }
  /* eslint-enable react-hooks/set-state-in-effect */
 }, [activeTab, selectedDay]);

 /* ── Day selection ── */
 const handleSelectDay = useCallback(async (day: number) => {
  setSelectedDay(day);
  setDayLoading(true);
  try {
   const todos = await queryDayTodos(day);
   setDayTodos(todos);
  } catch (err) {
   console.error("Failed to query day TODOs:", err);
   setDayTodos([]);
  } finally {
   setDayLoading(false);
  }
 }, []);

 const handleBackToCalendar = useCallback(() => {
  setSelectedDay(null);
  setDayTodos([]);
 }, []);

 /* ── Misc page navigation ── */
 const handleSelectPage = useCallback((pageName: string) => {
  setSelectedPage(pageName);
 }, []);

 const handleBackToPages = useCallback(() => {
  setSelectedPage(null);
 }, []);

 /* ── Drag to journal ── */
 const handleDropOnJournal = useCallback(
  async (blockUuid: string) => {
   try {
    const journalDay = await moveTodoToJournal(blockUuid, selectedDay ?? undefined);
    setDaysByYear((prev) => {
     const next = new Map(prev);
     const year = Math.floor(journalDay / 10000);
     const days = new Set(next.get(year) ?? []);
     days.add(journalDay);
     next.set(year, days);
     return next;
    });
    if (selectedDay !== null) {
     const todos = await queryDayTodos(journalDay);
     setDayTodos(todos);
    }
   } catch (err) {
    console.error("Failed to move TODO to journal:", err);
   }
  },
  [selectedDay]
 );

 const handleJournalDelete = useCallback(async (blockUuid: string) => {
  try {
   await deleteJournalBlock(blockUuid);
   if (selectedDay !== null) {
    const todos = await queryDayTodos(selectedDay);
    setDayTodos(todos);
   }
  } catch (err) {
   console.error("Failed to delete journal block:", err);
  }
 }, [selectedDay]);

 const handleEdit = useCallback(async (blockUuid: string, newContent: string) => {
  try {
   const block = await logseq.Editor.getBlock(blockUuid);
   if (!block?.content) return;
   // Reconstruct full content: preserve marker + priority, replace body
   const raw = block.content as string;
   const markerMatch = raw.match(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i);
   const priorityMatch = raw.match(/\[#(A|B|C)\]\s*/);
   let prefix = "";
   if (markerMatch) prefix += markerMatch[0];
   if (priorityMatch) prefix += priorityMatch[0];
   await logseq.Editor.updateBlock(blockUuid, prefix + newContent);
   if (selectedDay !== null) {
    const todos = await queryDayTodos(selectedDay);
    setDayTodos(todos);
   }
  } catch (err) {
   console.error("Failed to edit block:", err);
  }
 }, [selectedDay]);

 const handleReorder = useCallback(async (activeUuid: string, overUuid: string) => {
  console.log("[time-log] handleReorder:", activeUuid, overUuid);
  try {
   await logseq.Editor.moveBlock(activeUuid, overUuid, { before: false });
   console.log("[time-log] moveBlock done");
   // Swap locally to avoid losing manual order from re-query sort
   setDayTodos((prev) => {
    const idx1 = prev.findIndex((t) => t.uuid === activeUuid);
    const idx2 = prev.findIndex((t) => t.uuid === overUuid);
    if (idx1 === -1 || idx2 === -1) return prev;
    const next = [...prev];
    const [item] = next.splice(idx1, 1);
    next.splice(idx2, 0, item);
    return next;
   });
  } catch (err) {
   console.error("Failed to reorder:", err);
  }
 }, [selectedDay]);

 const handleChangePriority = useCallback(async (blockUuid: string, priority: TodoPriority | null) => {
  try {
   const block = await logseq.Editor.getBlock(blockUuid);
   let targetUuid = blockUuid;
   let rawContent = block?.content;
   // Resolve reference blocks
   if (rawContent && typeof rawContent === "string") {
    const refMatch = rawContent.match(/\(\(([a-f0-9-]+)\)\)/);
    if (refMatch) {
     targetUuid = refMatch[1];
     const refBlock = await logseq.Editor.getBlock(refMatch[1]);
     rawContent = refBlock?.content;
    }
   }
   if (!rawContent || typeof rawContent !== "string") return;
   console.log("[time-log] changePriority:", { blockUuid, targetUuid, priority, rawContent });
   // Replace or add priority tag, preserve the rest
   let body = rawContent.replace(/\[#(A|B|C)\]\s*/g, "").trim();
   if (priority) {
    body = body.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/, `$1 [#${priority}] `);
    if (!body.includes("[#")) body = `[#${priority}] ${body}`;
   }
   console.log("[time-log] changePriority new content:", body);
   await logseq.Editor.updateBlock(targetUuid, body);
   if (selectedDay !== null) {
    const todos = await queryDayTodos(selectedDay);
    setDayTodos(todos);
   }
  } catch (err) {
   console.error("Failed to change priority:", err);
  }
 }, [selectedDay]);

 const handleAddTodo = useCallback(async (text: string, priority: string) => {
  if (selectedDay === null) return;
  try {
   const pageName = await resolveJournalPageName(selectedDay)
    ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
   await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
   const prefix = priority ? `[#${priority}] ` : "";
   const content = `${prefix}TODO ${text}`;
   const todosBlockUuid = await findOrCreateTodosBlock(pageName);
   await logseq.Editor.insertBlock(todosBlockUuid, content, { sibling: false });
   const todos = await queryDayTodos(selectedDay);
   setDayTodos(todos);
  } catch (err) {
   console.error("Failed to add TODO:", err);
  }
 }, [selectedDay]);

 const handlePageDelete = useCallback(async (blockUuid: string) => {
  try {
   await deleteTodoWithRefs(blockUuid);
   const pageResults = await queryAllTodos();
   const grouped = groupTodos(pageResults);
   setPageTodos(sortPageTodos(grouped.pages));
  } catch (err) {
   console.error("Failed to delete TODO:", err);
  }
 }, []);

 const handleChangeMarker = useCallback(async (blockUuid: string, marker: string) => {
  try {
   await changeMarker(blockUuid, marker);
   if (selectedDay !== null) {
    const todos = await queryDayTodos(selectedDay);
    setDayTodos(todos);
   }
   const pageResults = await queryAllTodos();
   const grouped = groupTodos(pageResults);
   setPageTodos(sortPageTodos(grouped.pages));
  } catch (err) {
   console.error("Failed to change marker:", err);
  }
 }, [selectedDay]);

 /* ── Time Log DnD ── */
 // Track native drag from journal to show overlay in time grid
 useEffect(() => {
  const onDragStart = (e: DragEvent) => {
   try {
    const data = JSON.parse(e.dataTransfer?.getData("text/plain") || "{}");
    if (data.uuid && data.content) {
     setNativeDragState({ uuid: data.uuid, content: data.content, startMinutes: null, shiftKey: false });
    }
   } catch { /* ignore non-our drags */ }
  };
  const onDragEnd = () => setNativeDragState(null);
  window.addEventListener("dragstart", onDragStart);
  window.addEventListener("dragend", onDragEnd);
  return () => {
   window.removeEventListener("dragstart", onDragStart);
   window.removeEventListener("dragend", onDragEnd);
  };
 }, []);

 const handleDragOverGrid = useCallback((minutes: number | null, shiftKey?: boolean) => {
  setNativeDragState(prev => prev ? { ...prev, startMinutes: minutes, shiftKey: !!shiftKey } : null);
 }, []);

 function deltaToMinutes(deltaY: number): number {
  return Math.round((deltaY / timeLogHourHeight) * 60 / 5) * 5;
 }

 const computeDefaultMinutes = useCallback((): number => {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.round(mins / 5) * 5;
 }, []);

 /* ── Time Log persistence ── */
 const refreshTimeLog = useCallback(async () => {
  if (selectedDay === null) return;
  await new Promise(r => setTimeout(r, 100));
  const entries = await queryTimeLogEntries(selectedDay);
  setTimeLogEntries(entries);
 }, [selectedDay]);

 const updateEntryLocal = useCallback((uuid: string, patch: Partial<TimeLogEntry>) => {
  setTimeLogEntries(prev => prev.map(e => e.uuid === uuid ? { ...e, ...patch } : e));
 }, []);

 const addEntryLocal = useCallback((entry: TimeLogEntry) => {
  setTimeLogEntries(prev => [...prev, entry]);
 }, []);

 const createTimeLogEntryLoc = useCallback(async (todoUuid: string, startMinutes: number, endMinutes: number) => {
  if (selectedDay === null) return;
  // Resolve reference chain: if block is itself a ((ref)), use the original UUID
  let resolvedUuid = todoUuid;
  try {
   const sourceBlock = await logseq.Editor.getBlock(todoUuid);
   const rawContent = typeof sourceBlock?.content === "string" ? sourceBlock.content : "";
   const refMatch = rawContent.match(/\(\(([a-f0-9-]+)\)\)/);
   if (refMatch) resolvedUuid = refMatch[1];
  } catch { /* use original uuid */ }
  const pageName = await resolveJournalPageName(selectedDay)
   ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
  await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
  const blockUuid = await findOrCreateTimeLogBlock(pageName);
  await logseq.Editor.insertBlock(blockUuid, `${formatHM(startMinutes)} - ${formatHM(endMinutes)} ((${resolvedUuid}))`, { sibling: false });
  await refreshTimeLog();
 }, [selectedDay, refreshTimeLog]);

 const createNonTaskEntry = useCallback(async (startMinutes: number, endMinutes: number, activity: string) => {
  if (selectedDay === null) return;
  const pageName = await resolveJournalPageName(selectedDay)
   ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
  await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
  const blockUuid = await findOrCreateTimeLogBlock(pageName);
  await logseq.Editor.insertBlock(blockUuid, `${formatHM(startMinutes)} - ${formatHM(endMinutes)} ${activity}`, { sibling: false });
  refreshTimeLog();
 }, [selectedDay, refreshTimeLog]);

 const deleteTimeLogEntry = useCallback(async (uuid: string) => {
  if (!uuid.startsWith("clock-")) {
   await logseq.Editor.removeBlock(uuid);
  }
  setSelectedBlockUuid(null);
  setTimeLogEntries(prev => prev.filter(e => e.uuid !== uuid));
 }, [selectedDay, refreshTimeLog]);

 const handleDropOnTimeLog = useCallback(async (uuid: string, startMinutes: number) => {
  const endMinutes = Math.min(24 * 60, startMinutes + 25);
  await createTimeLogEntryLoc(uuid, startMinutes, endMinutes);
  setNativeDragState(null);
 }, [createTimeLogEntryLoc]);

 const handleTimeLogDragStart = useCallback((event: DragStartEvent) => {
  const data = event.active.data.current as DragData | undefined;
  setDragActiveData(data ?? null);
  // Only show DragOverlay for create-selection, not for time-block moves
  if (data?.type !== "create-selection") {
   setDragActiveData(null);
  }
  if (data?.type === "create-selection") {
   const scrollEl = gridScrollRef.current;
   if (scrollEl) {
    const gridRect = scrollEl.getBoundingClientRect();
    const ae = event.activatorEvent;
    if (!ae || !("clientY" in ae)) return;
    const relativeY = (ae as PointerEvent).clientY - gridRect.top + scrollEl.scrollTop;
    const minutes = (relativeY / timeLogHourHeight) * 60;
    const start = Math.round(minutes / 5) * 5;
    dragStartRef.current = start;
    dragStartPixelRef.current = relativeY;
    setDragStartMinutes(start);
   }
  }
 }, [timeLogHourHeight]);

 const handleTimeLogDragMove = useCallback((event: DragMoveEvent) => {
  const data = event.active.data.current as DragData | undefined;
  if (!data) return;
  const scrollEl = gridScrollRef.current;
  if (!scrollEl) return;

  let relativeY: number;
  if (data.type === "create-selection") {
   relativeY = (dragStartPixelRef.current ?? 0) + event.delta.y;
  } else {
   const gridRect = scrollEl.getBoundingClientRect();
   const translated = event.active.rect.current.translated;
   if (!translated) return;
   const pointerY = translated.top + translated.height / 2;
   relativeY = pointerY - gridRect.top + scrollEl.scrollTop;
  }
  const minutes = (relativeY / timeLogHourHeight) * 60;
  const snapped = Math.round(minutes / 5) * 5;
  setDragOverMinutes(Math.max(0, Math.min(23 * 60 + 55, snapped)));
  dragOverRef.current = Math.max(0, Math.min(23 * 60 + 55, snapped));

  if (data.type === "time-block-top" && data.uuid) {
   setResizeState({ uuid: data.uuid, type: "top", minutes: dragOverRef.current ?? snapped });
  } else if (data.type === "time-block-bottom" && data.uuid) {
   setResizeState({ uuid: data.uuid, type: "bottom", minutes: dragOverRef.current ?? snapped });
  } else if (data.type === "time-block" && data.uuid && data.startMinutes !== undefined && data.endMinutes !== undefined) {
   const duration = data.endMinutes - data.startMinutes;
   const ms = dragOverRef.current ?? snapped;
   setMoveState({ uuid: data.uuid, startMinutes: Math.max(0, Math.min(23 * 60 + 55 - duration, ms)) });
  } else if (data.type === "create-selection") {
   const start = dragStartRef.current ?? snapped;
   const end = Math.max(start + 5, snapped);
   setCreateState({ startMinutes: start, endMinutes: end });
  }
 }, [timeLogHourHeight]);
 const handleTimeLogDragEnd = useCallback(async (event: DragEndEvent) => {
  const { active, over } = event;
  const data = active.data.current as DragData | undefined;
  const overMinutes = dragOverRef.current;
  const startMinutesValue = dragStartRef.current;
  setDragActiveData(null);
  setDragOverMinutes(null);
  dragOverRef.current = null;
  setDragStartMinutes(null);
  dragStartRef.current = null;
  dragStartPixelRef.current = null;
  setResizeState(null);
  setMoveState(null);
  setCreateState(null);
  if (!data) return;
  if (data.type !== "create-selection" && !over) return;

  const overId = over ? String(over.id) : "";

  switch (data.type) {
   case "time-block": {
    if (!data.uuid || data.startMinutes === undefined || data.endMinutes === undefined) return;
    const duration = data.endMinutes - data.startMinutes;
    const newStart = overMinutes !== null ? Math.max(0, Math.min(23 * 60 + 59 - duration, overMinutes)) : data.startMinutes;
    const newEnd = newStart + duration;
    await updateTimeLogEntry(data.uuid, newStart, newEnd);
    updateEntryLocal(data.uuid, { startMinutes: newStart, endMinutes: newEnd });
    break;
   }
   case "time-block-top": {
    if (!data.uuid || data.endMinutes === undefined) return;
    const newStart = overMinutes !== null ? Math.max(0, Math.min(data.endMinutes - 5, overMinutes)) : (data.startMinutes ?? data.endMinutes - 25);
    if (newStart >= data.endMinutes - 5) return;
    await updateTimeLogEntry(data.uuid, newStart, data.endMinutes);
    updateEntryLocal(data.uuid, { startMinutes: newStart });
    break;
   }
   case "time-block-bottom": {
    if (!data.uuid || data.startMinutes === undefined) return;
    const newEnd = overMinutes !== null ? Math.max(data.startMinutes + 5, Math.min(24 * 60, overMinutes)) : (data.endMinutes ?? data.startMinutes + 25);
    if (newEnd <= data.startMinutes + 5) return;
    await updateTimeLogEntry(data.uuid, data.startMinutes, newEnd);
    updateEntryLocal(data.uuid, { endMinutes: newEnd });
    break;
   }
   case "create-selection": {
    if (selectedDay === null) return;
    const startMinutes = startMinutesValue ?? computeDefaultMinutes();
    const endMinutes = overMinutes !== null ? Math.max(startMinutes + 5, Math.min(24 * 60, overMinutes)) : startMinutes + 25;
    // Create entry directly and open inline edit
    const pageName = await resolveJournalPageName(selectedDay)
     ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
    const blockUuid = await findOrCreateTimeLogBlock(pageName);
    await logseq.Editor.insertBlock(blockUuid, `${formatHM(startMinutes)} - ${formatHM(endMinutes)} Name`, { sibling: false });
    await refreshTimeLog();
    const entries = await queryTimeLogEntries(selectedDay);
    const newEntry = entries.find(e => e.startMinutes === startMinutes && e.endMinutes === endMinutes && !e.isClockEntry);
    if (newEntry) {
     setSelectedBlockUuid(null);
     setEditingBlockUuid(newEntry.uuid);
    }
    break;
   }
  }
 }, [selectedDay]);

 const handleDoubleClickBlock = useCallback((uuid: string) => {
  setSelectedBlockUuid(null);
  setEditingBlockUuid(uuid);
 }, []);

 const handleRenameBlock = useCallback(async (uuid: string, newName: string, todoUuid?: string) => {
  const block = await logseq.Editor.getBlock(uuid);
  if (!block) return;
  const content = String(block.content ?? "");
  const match = content.match(/^((\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))\s+(.*)$/);
  if (match) {
   const timePart = match[1];
   const oldRest = match[4];
   if (todoUuid) {
    // Shift-drop: replace entire content with just the reference
    await logseq.Editor.updateBlock(uuid, `${timePart} ((${todoUuid}))`);
    await refreshTimeLog();
    // Resolve TODO name for display
    let resolvedName = "";
    try {
     const refBlock = await logseq.Editor.getBlock(todoUuid);
     if (refBlock?.content) {
      let c = String(refBlock.content);
      c = c.replace(/:LOGBOOK:[\s\S]*?:END:/gi, "");
      c = c.replace(/^\w+::\s.*$/gm, "");
      c = c.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i, "");
      c = c.replace(/^\[#(A|B|C)\]\s*/i, "");
      resolvedName = c.trim();
     }
    } catch { /* use empty */ }
    updateEntryLocal(uuid, { activity: resolvedName, todoUuid });
    // Refresh to get updated entry with todoUuid
   } else {
    // Inline rename: just update the name
    await logseq.Editor.updateBlock(uuid, `${timePart} ${newName}`);
    updateEntryLocal(uuid, { activity: newName, todoUuid: undefined });
   }
  }
  setEditingBlockUuid(null);
 }, [refreshTimeLog, updateEntryLocal]);

 /* ── Journal (left) content ── */
 const journalContent = selectedDay !== null ? (
  <div
   className="journal-drop-zone"
   style={dragActiveData ? { overflow: 'hidden' } : undefined}
   {...(activeTab === "tasks" ? { onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, onDrop: (e: React.DragEvent) => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("text/plain")); if (data.uuid) handleDropOnJournal(data.uuid); } catch { const uuid = e.dataTransfer.getData("text/plain"); if (uuid) handleDropOnJournal(uuid); } } } : {})}
  >
   <DayDetail
    readOnly={activeTab === "timelog"}
    journalDay={selectedDay}
    pageName={
     `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`
    }
    todos={dayTodos}
    loading={dayLoading}
    onBack={handleBackToCalendar}
    onDelete={handleJournalDelete}
    onChangeMarker={handleChangeMarker}
    onAddTodo={handleAddTodo}
    onRefresh={async () => {
     if (selectedDay !== null) {
      const todos = await queryDayTodos(selectedDay);
      setDayTodos(todos);
     }
    }}
    onEdit={handleEdit}
    onReorder={handleReorder}
    onChangePriority={handleChangePriority}
   />
  </div>
 ) : (
  <div
   className="journal-drop-zone"
   style={dragActiveData ? { overflow: 'hidden' } : undefined}
   {...(activeTab === "tasks" ? { onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, onDrop: (e: React.DragEvent) => { e.preventDefault(); try { const data = JSON.parse(e.dataTransfer.getData("text/plain")); if (data.uuid) handleDropOnJournal(data.uuid); } catch { const uuid = e.dataTransfer.getData("text/plain"); if (uuid) handleDropOnJournal(uuid); } } } : {})}
  >
   <CalendarView
    yearRange={yearRange}
    daysByYear={daysByYear}
    onSelectDay={handleSelectDay}
    onExpandUp={expandUp}
    onExpandDown={expandDown}
   />
  </div>
 );

 /* ── Misc (right) content ── */
 const rightContent = activeTab === "tasks" ? (
  selectedPage !== null ? (
   <PageDetail pageName={selectedPage} onBack={handleBackToPages} onChangeMarker={handleChangeMarker} />
  ) : (
   <PageTodos
    todos={pageTodos}
    loading={loading}
    error={error}
    onDelete={handlePageDelete}
    onSelectPage={handleSelectPage}
    onChangeMarker={handleChangeMarker}
   />
  )
 ) : (
  <TimeLogView
   journalDay={selectedDay ?? Math.floor(new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate())}
   gridRef={gridScrollRef}
   hourHeight={timeLogHourHeight}
   onHourHeightChange={setTimeLogHourHeight}
   resizeState={resizeState}
   createState={createState}
   moveState={moveState}
   entries={timeLogEntries}
   loading={timeLogLoading}
   selectedBlockUuid={selectedBlockUuid}
   onSelectBlock={setSelectedBlockUuid}
   onDoubleClickBlock={handleDoubleClickBlock}
   editingBlockUuid={editingBlockUuid}
   onRenameBlock={handleRenameBlock}
   onDeleteBlock={deleteTimeLogEntry}
   onDayChange={handleSelectDay}
   onDropTodo={handleDropOnTimeLog}
   nativeDragState={nativeDragState}
   onDragOverGrid={handleDragOverGrid}
  />
 );

 return (
  <div className="time-log-app">
   <HeaderBar activeTab={activeTab} onTabChange={setActiveTab} onRefresh={handleRefresh} onClose={handleClose} />
   <main className="time-log-content">
    {activeTab === "tasks" ? (
     <SplitView left={journalContent} right={rightContent} />
    ) : (
     <SplitView left={journalContent} right={
      <DndContext
       sensors={timeLogSensors}
       collisionDetection={pointerWithin}
       onDragStart={handleTimeLogDragStart}
       onDragMove={handleTimeLogDragMove}
       onDragEnd={handleTimeLogDragEnd}
      >
       {rightContent}
       <DragOverlay>
        {dragActiveData && <DragPreview data={dragActiveData} overMinutes={dragOverMinutes} dragStartMinutes={dragStartMinutes} hourHeight={timeLogHourHeight} entries={timeLogEntries} />}
       </DragOverlay>
      </DndContext>
     } />
    )}

    {createModalOpen && createModalRange && (
     <div className="time-create-modal-overlay" onClick={() => setCreateModalOpen(false)}>
      <div className="time-create-modal" onClick={(e) => e.stopPropagation()}>
       <h3>New Entry</h3>
       <p className="time-create-modal-range">
        {formatHM(createModalRange.start)} - {formatHM(createModalRange.end)}
       </p>
       <input
        type="text"
        className="time-create-modal-input"
        placeholder="Activity name"
        value={createModalName}
        onChange={(e) => setCreateModalName(e.target.value)}
        onKeyDown={(e) => {
         if (e.key === "Enter" && createModalName.trim()) {
          createNonTaskEntry(createModalRange.start, createModalRange.end, createModalName.trim());
          setCreateModalOpen(false);
         }
         if (e.key === "Escape") setCreateModalOpen(false);
        }}
        autoFocus
       />
       <div className="time-create-modal-actions">
        <button className="time-create-modal-cancel" onClick={() => setCreateModalOpen(false)}>Cancel</button>
        <button className="time-create-modal-create"
         onClick={() => {
          if (createModalName.trim()) {
           createNonTaskEntry(createModalRange.start, createModalRange.end, createModalName.trim());
           setCreateModalOpen(false);
          }
         }}>Create</button>
       </div>
      </div>
     </div>
    )}
   </main>
  </div>
 );
}
