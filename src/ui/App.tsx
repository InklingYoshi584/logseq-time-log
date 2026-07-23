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
 parseTimeLogEntry,
 snapTo5,
 formatTimeLogEntry,
} from "./logseq";
import HeaderBar from "./components/HeaderBar";
import TimeLogView from "./components/TimeLogView";
import SplitView from "./components/SplitView";
import CalendarView from "./components/CalendarView";
import DayDetail from "./components/DayDetail";
import PageTodos from "./components/PageTodos";
import PageDetail from "./components/PageDetail";
import QuickCreateDialog from "./components/QuickCreateDialog";

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
 const timeLogEntriesRef = useRef(timeLogEntries);
 timeLogEntriesRef.current = timeLogEntries;
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
 const [quickCreateOpen, setQuickCreateOpen] = useState(false);
 const autoClockRef = useRef<Set<string>>(new Set()); // entries already auto-processed
 const clockOutRef = useRef<Set<string>>(new Set());
 const manualMarkerRef = useRef<Map<string, string>>(new Map()); // original TODO markers
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


 const syncToLogbook = async (entry: { todoUuid?: string; startMinutes: number; endMinutes: number; isScheduled?: boolean }, oldStart?: number) => {
  if (!entry.todoUuid || !selectedDay || entry.endMinutes === null || entry.isScheduled) return;
  try {
   const block = await logseq.Editor.getBlock(entry.todoUuid);
   if (!block?.content) return;
   const content = String(block.content);
   const y = Math.floor(selectedDay / 10000);
   const m = Math.floor((selectedDay % 10000) / 100);
   const d = selectedDay % 100;
   const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
   const sh = String(Math.floor(entry.startMinutes / 60)).padStart(2, "0");
   const sm = String(entry.startMinutes % 60).padStart(2, "0");
   const eh = String(Math.floor(entry.endMinutes / 60)).padStart(2, "0");
   const em = String(entry.endMinutes % 60).padStart(2, "0");
   const durH = String(Math.floor((entry.endMinutes - entry.startMinutes) / 60)).padStart(2, "0");
   const durM = String((entry.endMinutes - entry.startMinutes) % 60).padStart(2, "0");
   const newClock = `CLOCK: [${dateStr} ${sh}:${sm}:00]--[${dateStr} ${eh}:${em}:00] =>  ${durH}:${durM}:00`;
   let newContent;
   if (oldStart !== undefined) {
    const osh = String(Math.floor(oldStart / 60)).padStart(2, "0");
    const osm = String(oldStart % 60).padStart(2, "0");
    const re = new RegExp(`CLOCK:\\s*\\[.*?${osh}:${osm}:\\d{2}\\].*`, "g");
    newContent = content.replace(re, newClock);
   } else {
    const lbMatch = content.match(/:LOGBOOK:([\s\S]*?):END:/i);
    if (lbMatch) {
     newContent = content.replace(/:LOGBOOK:([\s\S]*?):END:/i, `:LOGBOOK:$1${newClock}\n:END:`);
    } else {
     newContent = content + `\n:LOGBOOK:\n${newClock}\n:END:`;
    }
   }
   await logseq.Editor.updateBlock(entry.todoUuid, newContent);
  } catch { /* ignore */ }
 };

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

 // Auto-clock: monitor scheduled entries
 useEffect(() => {
  if (activeTab !== "timelog") return;
  const clockIn = async (entry: TimeLogEntry) => {
   if (!entry.todoUuid) return;
   try {
    const b = await logseq.Editor.getBlock(entry.todoUuid);
    if (b?.content) {
     const raw = String(b.content);
     const markerMatch = raw.match(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s/i);
     if (markerMatch && markerMatch[1] !== "DOING" && markerMatch[1] !== "DONE") {
      manualMarkerRef.current.set(entry.todoUuid, markerMatch[1]);
      await changeMarker(entry.todoUuid, "DOING");
     }
    }
   } catch { /* skip */ }
  };
  const clockOut = async (entry: TimeLogEntry) => {
   const updated = { ...entry, isScheduled: false, isScheduledStart: false, isScheduledEnd: false };
   const newContent = formatTimeLogEntry(updated);
   await logseq.Editor.updateBlock(entry.uuid, newContent);
   updateEntryLocal(entry.uuid, { isScheduled: false, isScheduledStart: false, isScheduledEnd: false });
   if (entry.todoUuid && entry.endMinutes !== null) {
    syncToLogbook({ ...updated, todoUuid: entry.todoUuid, startMinutes: entry.startMinutes, endMinutes: entry.endMinutes });
    const origMarker = manualMarkerRef.current.get(entry.todoUuid);
    if (origMarker) { await changeMarker(entry.todoUuid, origMarker); manualMarkerRef.current.delete(entry.todoUuid); }
   }
  };
  const tick = async () => {
   const now = new Date();
   const nowMins = now.getHours() * 60 + now.getMinutes();
   const entries = timeLogEntriesRef.current;
   const clockedIn = new Set(autoClockRef.current);
   const clockedOut = new Set(clockOutRef.current);
   let changed = false;
   for (const entry of entries) {
    if (!entry.isScheduled) continue;
    if (entry.isScheduledStart && nowMins >= entry.startMinutes && !clockedIn.has(entry.uuid)) {
     console.log("[auto-clock]", "clock in", entry.uuid, nowMins, ">=", entry.startMinutes);
     clockedIn.add(entry.uuid); changed = true;
     await clockIn(entry);
    }
    if (entry.isScheduledEnd && entry.endMinutes !== null && nowMins >= entry.endMinutes && !clockedOut.has(entry.uuid)) {
     console.log("[auto-clock]", "clock out", entry.uuid, nowMins, ">=", entry.endMinutes);
     clockedOut.add(entry.uuid); changed = true;
     await clockOut(entry);
    }
   }
   autoClockRef.current = clockedIn;
   clockOutRef.current = clockedOut;
   if (changed) await refreshTimeLog();
  };
  // Initial check after entries likely loaded
  const initId = setTimeout(tick, 500);
  const intervalId = setInterval(tick, 10000);
  return () => { clearTimeout(initId); clearInterval(intervalId); autoClockRef.current = new Set(); clockOutRef.current = new Set(); };
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

 const createTimeLogEntryLoc = useCallback(async (todoUuid: string, startMinutes: number, endMinutes: number, isFuture?: boolean) => {
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
  // Past drop → completed; future drop → scheduled
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const scheduled = isFuture ?? (startMinutes > nowMins);
  const content = formatTimeLogEntry({
   uuid: "", startMinutes, endMinutes, activity: "", todoUuid: resolvedUuid,
   isClockEntry: false, isScheduled: scheduled, isScheduledStart: scheduled,
   isScheduledEnd: scheduled,
  });
  await logseq.Editor.insertBlock(blockUuid, content, { sibling: false });
  if (!scheduled) {
   syncToLogbook({ todoUuid: resolvedUuid, startMinutes, endMinutes });
   if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
  }
  await refreshTimeLog();
 }, [selectedDay, refreshTimeLog]);

 const createNonTaskEntry = useCallback(async (startMinutes: number, endMinutes: number, activity: string) => {
  if (selectedDay === null) return;
  const pageName = await resolveJournalPageName(selectedDay)
   ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
  await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
  const blockUuid = await findOrCreateTimeLogBlock(pageName);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const scheduled = startMinutes > nowMins;
  const content = formatTimeLogEntry({
   uuid: "", startMinutes, endMinutes, activity,
   isClockEntry: false, isScheduled: scheduled, isScheduledStart: scheduled, isScheduledEnd: scheduled,
  });
  await logseq.Editor.insertBlock(blockUuid, content, { sibling: false });
  refreshTimeLog();
 }, [selectedDay, refreshTimeLog]);

 const deleteTimeLogEntry = useCallback(async (uuid: string) => {
  await logseq.Editor.removeBlock(uuid);
  // Remove CLOCK line from linked TODO's LOGBOOK
  const e = timeLogEntriesRef.current.find(en => en.uuid === uuid);
  if (e?.todoUuid) {
   try {
    const b = await logseq.Editor.getBlock(e.todoUuid);
    if (b?.content) {
     const sh = String(Math.floor(e.startMinutes / 60)).padStart(2, "0");
     const sm = String(e.startMinutes % 60).padStart(2, "0");
     const re = new RegExp(`CLOCK:\\s*\\[.*?${sh}:${sm}:\\d{2}\\].*\\n?`, "g");
     await logseq.Editor.updateBlock(e.todoUuid, String(b.content).replace(re, "")); if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
    }
   } catch { /* ignore */ }
  }
  setSelectedBlockUuid(null);
  setTimeLogEntries(prev => prev.filter(e => e.uuid !== uuid));
 }, [selectedDay, refreshTimeLog]);

 const handleDropOnTimeLog = useCallback(async (uuid: string, startMinutes: number) => {
  const endMinutes = Math.min(24 * 60, snapTo5(startMinutes + 25));
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  await createTimeLogEntryLoc(uuid, snapTo5(startMinutes), endMinutes, startMinutes > nowMins);
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



  const shiftKey = (event.activatorEvent as PointerEvent)?.shiftKey ?? false;
  switch (data.type) {
   case "time-block": {
    if (!data.uuid || data.startMinutes === undefined || data.endMinutes === undefined) return;
    const duration = data.endMinutes - data.startMinutes;
    const rawStart = overMinutes !== null ? Math.max(0, Math.min(23 * 60 + 59 - duration, overMinutes)) : data.startMinutes;
    const newStart = snapTo5(rawStart);
    const newEnd = newStart + duration;
    const e = timeLogEntriesRef.current.find(en => en.uuid === data.uuid);
    if (e?.isScheduled && !e.isScheduledStart && shiftKey) {
     // Shift-resize start on in-progress scheduled → error
     const updated = { ...e, startMinutes: newStart, endMinutes: newEnd, errorMinutes: newStart - data.startMinutes };
     await logseq.Editor.updateBlock(data.uuid, formatTimeLogEntry(updated));
     updateEntryLocal(data.uuid, { startMinutes: newStart, endMinutes: newEnd, errorMinutes: newStart - data.startMinutes });
    } else {
     await updateTimeLogEntry(data.uuid, newStart, newEnd);
     updateEntryLocal(data.uuid, { startMinutes: newStart, endMinutes: newEnd });
     if (e?.todoUuid) syncToLogbook({ ...e, startMinutes: newStart, endMinutes: newEnd }, data.startMinutes);
    }
    if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
    break;
   }
   case "time-block-top": {
    if (!data.uuid || data.endMinutes === undefined) return;
    const rawStart = overMinutes !== null ? Math.max(0, Math.min(data.endMinutes - 5, overMinutes)) : (data.startMinutes ?? data.endMinutes - 25);
    const newStart = snapTo5(rawStart);
    if (newStart >= data.endMinutes - 5) return;
    await updateTimeLogEntry(data.uuid, newStart, data.endMinutes);
    updateEntryLocal(data.uuid, { startMinutes: newStart });
    const e = timeLogEntriesRef.current.find(en => en.uuid === data.uuid);
    if (e?.isScheduled && shiftKey) {
     const updated = { ...e, startMinutes: newStart, errorMinutes: newStart - (data.startMinutes ?? 0) };
     await logseq.Editor.updateBlock(data.uuid, formatTimeLogEntry(updated));
     updateEntryLocal(data.uuid, { startMinutes: newStart, errorMinutes: newStart - (data.startMinutes ?? 0) });
    } else {
     await updateTimeLogEntry(data.uuid, newStart, data.endMinutes);
     updateEntryLocal(data.uuid, { startMinutes: newStart });
     if (e?.todoUuid && data.endMinutes) {
      syncToLogbook({ ...e, startMinutes: newStart, endMinutes: data.endMinutes }, data.startMinutes);
     }
    }
    if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
    break;
   }
   case "time-block-bottom": {
    if (!data.uuid || data.startMinutes === undefined) return;
    const rawEnd = overMinutes !== null ? Math.max(data.startMinutes + 5, Math.min(24 * 60, overMinutes)) : (data.endMinutes ?? data.startMinutes + 25);
    const newEnd = snapTo5(rawEnd);
    if (newEnd <= data.startMinutes + 5) return;
    const e = timeLogEntriesRef.current.find(en => en.uuid === data.uuid);
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    if (e?.isScheduled) {
     // Scheduled: shift-resize → update plan if > now, else error + complete
     if (newEnd > nowMins && !shiftKey) {
      // Just update planned end time
      const updated = { ...e, endMinutes: newEnd };
      await logseq.Editor.updateBlock(data.uuid, formatTimeLogEntry(updated));
      updateEntryLocal(data.uuid, { endMinutes: newEnd });
     } else {
      // Complete with error
      const err = newEnd - (data.endMinutes ?? data.startMinutes + 25);
      const updated = { ...e, endMinutes: newEnd, isScheduled: false, isScheduledStart: false, isScheduledEnd: false, errorMinutes: err };
      await logseq.Editor.updateBlock(data.uuid, formatTimeLogEntry(updated));
      updateEntryLocal(data.uuid, { endMinutes: newEnd, isScheduled: false, isScheduledStart: false, isScheduledEnd: false, errorMinutes: err });
      if (e?.todoUuid && data.endMinutes) syncToLogbook({ ...e, startMinutes: data.startMinutes, endMinutes: newEnd }, data.startMinutes);
     }
    } else {
     await updateTimeLogEntry(data.uuid, data.startMinutes, newEnd);
     updateEntryLocal(data.uuid, { endMinutes: newEnd });
     { if (e?.todoUuid && data.startMinutes !== undefined) syncToLogbook({ ...e, startMinutes: data.startMinutes, endMinutes: newEnd }, data.startMinutes); }
    }
    if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
    break;
   }
   case "create-selection": {
    if (selectedDay === null) return;
    const startMinutes = startMinutesValue ?? computeDefaultMinutes();
    const endMinutes = snapTo5(overMinutes !== null ? Math.max(startMinutes + 5, Math.min(24 * 60, overMinutes)) : startMinutes + 25);
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const scheduled = startMinutes > nowMins;
    const pageName = await resolveJournalPageName(selectedDay)
     ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
    const blockUuid = await findOrCreateTimeLogBlock(pageName);
    const content = formatTimeLogEntry({
     uuid: "", startMinutes, endMinutes, activity: "Name",
     isClockEntry: false, isScheduled: scheduled, isScheduledStart: scheduled, isScheduledEnd: scheduled,
    });
    await logseq.Editor.insertBlock(blockUuid, content, { sibling: false });
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
  const entry = parseTimeLogEntry(content, uuid, false);
  if (!entry) return;
  const updated = { ...entry };
  if (todoUuid) {
   updated.todoUuid = todoUuid;
   // Resolve display name from TODO
   try {
    const refBlock = await logseq.Editor.getBlock(todoUuid);
    if (refBlock?.content) {
     let c = String(refBlock.content);
     c = c.replace(/:LOGBOOK:[\s\S]*?:END:/gi, "");
     c = c.replace(/^\w+::\s.*$/gm, "");
     c = c.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i, "");
     c = c.replace(/^\[#(A|B|C)\]\s*/i, "");
     updated.activity = c.trim();
    }
   } catch { /* keep existing */ }
  } else {
   updated.activity = newName;
   updated.todoUuid = undefined;
  }
  const newContent = formatTimeLogEntry(updated);
  await logseq.Editor.updateBlock(uuid, newContent);
  updateEntryLocal(uuid, { activity: updated.activity, todoUuid: updated.todoUuid });
  setEditingBlockUuid(null);
 }, [refreshTimeLog, updateEntryLocal]);

 const handleClickBlock = useCallback(async (uuid: string) => {
  const e = timeLogEntriesRef.current.find(en => en.uuid === uuid);
  if (!e) return;
  const nowMins = snapTo5(new Date().getHours() * 60 + new Date().getMinutes());
  if (e.endMinutes === null) {
   // Open-ended → close at current time
   const updated = { ...e, endMinutes: nowMins, isScheduled: false, isScheduledStart: false, isScheduledEnd: false };
   const content = formatTimeLogEntry(updated);
   await logseq.Editor.updateBlock(uuid, content);
   updateEntryLocal(uuid, { endMinutes: nowMins });
   if (e.todoUuid) syncToLogbook({ ...e, startMinutes: e.startMinutes, endMinutes: nowMins });
  } else if (e.isScheduled) {
   // In-progress scheduled → manual complete with error
   autoClockRef.current.add(uuid); // stop auto-clock from re-processing
   const endError = e.endMinutes - nowMins; // positive = late, negative = early
   const updated = { ...e, endMinutes: nowMins, isScheduled: false, isScheduledStart: false, isScheduledEnd: false, errorMinutes: endError };
   const content = formatTimeLogEntry(updated);
   await logseq.Editor.updateBlock(uuid, content);
   updateEntryLocal(uuid, { endMinutes: nowMins, isScheduled: false, isScheduledStart: false, isScheduledEnd: false, errorMinutes: endError });
   if (e.todoUuid) syncToLogbook({ ...e, startMinutes: e.startMinutes, endMinutes: nowMins });
  } else {
   return; // regular completed block — no action
  }
  if (selectedDay) setTimeout(() => queryDayTodos(selectedDay).then(setDayTodos), 150);
  await refreshTimeLog();
 }, [selectedDay, refreshTimeLog, updateEntryLocal]);

 const handleClickCurrentTime = useCallback(() => {
  setQuickCreateOpen(true);
 }, []);

 const handleQuickCreate = useCallback(async (name: string, todoUuid?: string) => {
  if (selectedDay === null) return;
  const nowMins = snapTo5(new Date().getHours() * 60 + new Date().getMinutes());
  const pageName = await resolveJournalPageName(selectedDay)
   ?? `${Math.floor(selectedDay / 10000)}${String(Math.floor((selectedDay % 10000) / 100)).padStart(2, "0")}${String(selectedDay % 100).padStart(2, "0")}`;
  await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
  const blockUuid = await findOrCreateTimeLogBlock(pageName);
  const content = formatTimeLogEntry({
   uuid: "", startMinutes: nowMins, endMinutes: null, activity: name, todoUuid,
   isClockEntry: false, isScheduled: false, isScheduledStart: false, isScheduledEnd: false,
  });
  await logseq.Editor.insertBlock(blockUuid, content, { sibling: false });
  await refreshTimeLog();
  setQuickCreateOpen(false);
 }, [selectedDay, refreshTimeLog]);
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
   onClickBlock={handleClickBlock}
   onClickCurrentTime={handleClickCurrentTime}
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
    <QuickCreateDialog
     open={quickCreateOpen}
     onClose={() => setQuickCreateOpen(false)}
     onCreate={handleQuickCreate}
     dayTodos={dayTodos.map(t => ({ uuid: t.uuid, content: t.content }))}
    />
   </main>
  </div>
 );
}
