import { useState, useEffect, useCallback } from "react";
import type { TodoBlock, TodoPriority } from "./types";
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
import HeaderBar from "./components/HeaderBar";
import SplitView from "./components/SplitView";
import CalendarView from "./components/CalendarView";
import DayDetail from "./components/DayDetail";
import PageTodos from "./components/PageTodos";
import PageDetail from "./components/PageDetail";

const INITIAL_YEAR_WINDOW = 3;

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

  /* ── Close / ESC ── */
  const handleClose = useCallback(() => {
    logseq.hideMainUI();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [handleClose, selectedDay, selectedPage]);

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

  useEffect(() => {
    // eslint-disable-next-line -- initial load
    initYears();
  }, [initYears]);

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

  /* ── Journal (left) content ── */
  const journalContent = selectedDay !== null ? (
    <div
      className="journal-drop-zone"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (data.uuid) handleDropOnJournal(data.uuid);
        } catch {
          const uuid = e.dataTransfer.getData("text/plain");
          if (uuid) handleDropOnJournal(uuid);
        }
      }}
    >
      <DayDetail
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
        onReorder={handleReorder}
        onChangePriority={handleChangePriority}
      />
    </div>
  ) : (
    <div
      className="journal-drop-zone"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (data.uuid) handleDropOnJournal(data.uuid);
        } catch {
          const uuid = e.dataTransfer.getData("text/plain");
          if (uuid) handleDropOnJournal(uuid);
        }
      }}
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
  const miscContent = selectedPage !== null ? (
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
  );

  return (
    <div className="time-log-app">
      <HeaderBar onRefresh={initYears} onClose={handleClose} />
      <main className="time-log-content">
        <SplitView left={journalContent} right={miscContent} />
      </main>
    </div>
  );
}
