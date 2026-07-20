import { useState, useEffect, useCallback } from "react";
import type { TodoBlock, TabId, ViewLayout } from "./types";
import {
  queryAllTodos,
  queryJournalDaysWithTodos,
  queryDayTodos,
  groupTodos,
  sortPageTodos,
  moveTodoToJournal,
  deleteJournalBlock,
  deleteTodoWithRefs,
} from "./logseq";
import TabBar from "./components/TabBar";
import SplitView from "./components/SplitView";
import CalendarView from "./components/CalendarView";
import DayDetail from "./components/DayDetail";
import PageTodos from "./components/PageTodos";
import PageDetail from "./components/PageDetail";

const INITIAL_YEAR_WINDOW = 3;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("journal");
  const [viewLayout, setViewLayout] = useState<ViewLayout>("single");
  const [pageTodos, setPageTodos] = useState<TodoBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Calendar state ── */
  const currentYear = new Date().getFullYear();
  const [yearRange, setYearRange] = useState({ start: currentYear, end: currentYear });
  const [daysByYear, setDaysByYear] = useState<Map<number, Set<number>>>(new Map());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [dayTodos, setDayTodos] = useState<TodoBlock[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  /* ── Close / ESC ── */
  const handleClose = useCallback(() => {
    logseq.hideMainUI();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedDay !== null) {
          setSelectedDay(null);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, selectedDay]);

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
      // Load current year
      await loadYear(currentYear);

      // Expand to window
      const half = Math.floor(INITIAL_YEAR_WINDOW / 2);
      const start = currentYear - half;
      const end = currentYear + half;
      setYearRange({ start, end });

      const promises = [];
      for (let y = start; y <= end; y++) {
        if (y !== currentYear) promises.push(loadYear(y));
      }
      await Promise.all(promises);

      // Load page TODOs
      const pageResults = await queryAllTodos();
      const grouped = groupTodos(pageResults);
      setPageTodos(sortPageTodos(grouped.pages));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to load:", err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentYear, loadYear]);

  useEffect(() => {
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
        // Immediately add the day to calendar data so it highlights
        setDaysByYear((prev) => {
          const next = new Map(prev);
          const year = Math.floor(journalDay / 10000);
          const days = new Set(next.get(year) ?? []);
          days.add(journalDay);
          next.set(year, days);
          return next;
        });
        // If viewing a specific day, refresh its TODO list
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

  /* ── Journal tab content ── */
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
        todos={dayTodos}
        loading={dayLoading}
        onBack={handleBackToCalendar}
        onDelete={handleJournalDelete}
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

  /* ── Page tab content ── */
  const pageContent = selectedPage !== null ? (
    <PageDetail pageName={selectedPage} onBack={handleBackToPages} />
  ) : (
    <PageTodos
      todos={pageTodos}
      loading={loading}
      error={error}
      onDelete={handlePageDelete}
      onSelectPage={handleSelectPage}
    />
  );

  const mainContent =
    viewLayout === "split" ? (
      <SplitView left={journalContent} right={pageContent} />
    ) : activeTab === "journal" ? (
      journalContent
    ) : (
      pageContent
    );

  return (
    <div className="time-log-app">
      <main className="time-log-content">
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          viewLayout={viewLayout}
          onToggleSplit={() =>
            setViewLayout((v) => (v === "split" ? "single" : "split"))
          }
          onRefresh={initYears}
          onClose={handleClose}
        />
        {mainContent}
      </main>
    </div>
  );
}
