import { useState, useEffect, useCallback } from "react";
import type { TodoBlock, TabId, ViewLayout } from "./types";
import {
  queryAllTodos,
  queryJournalDaysWithTodos,
  queryDayTodos,
  groupTodos,
  sortPageTodos,
  moveTodoToJournal,
} from "./logseq";
import TabBar from "./components/TabBar";
import SplitView from "./components/SplitView";
import CalendarView from "./components/CalendarView";
import DayDetail from "./components/DayDetail";
import PageTodos from "./components/PageTodos";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("journal");
  const [viewLayout, setViewLayout] = useState<ViewLayout>("single");
  const [pageTodos, setPageTodos] = useState<TodoBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Calendar state ── */
  const [year, setYear] = useState(new Date().getFullYear());
  const [daysWithTodos, setDaysWithTodos] = useState<Set<number>>(new Set());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
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

  /* ── Load calendar metadata + page TODOs ── */
  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [days, pageResults] = await Promise.all([
        queryJournalDaysWithTodos(year),
        queryAllTodos(),
      ]);
      setDaysWithTodos(days);
      const grouped = groupTodos(pageResults);
      setPageTodos(sortPageTodos(grouped.pages));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to load:", err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

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

  const handleYearChange = useCallback((delta: number) => {
    setYear((y) => y + delta);
    setSelectedDay(null);
  }, []);

  /* ── Drag to journal ── */
  const handleDropOnJournal = useCallback(
    async (blockUuid: string) => {
      try {
        await moveTodoToJournal(blockUuid);
        await loadCalendar();
      } catch (err) {
        console.error("Failed to move TODO to journal:", err);
      }
    },
    [loadCalendar]
  );

  /* ── Journal tab content ── */
  const journalContent = selectedDay !== null ? (
    <DayDetail
      journalDay={selectedDay}
      todos={dayTodos}
      loading={dayLoading}
      onBack={handleBackToCalendar}
    />
  ) : (
    <CalendarView
      year={year}
      daysWithTodos={daysWithTodos}
      onSelectDay={handleSelectDay}
      onYearChange={handleYearChange}
    />
  );

  /* ── Page tab content ── */
  const pageContent = <PageTodos todos={pageTodos} loading={loading} error={error} />;

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
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        viewLayout={viewLayout}
        onToggleSplit={() =>
          setViewLayout((v) => (v === "split" ? "single" : "split"))
        }
        onRefresh={loadCalendar}
        onClose={handleClose}
      />
      <main className="time-log-content">{mainContent}</main>
    </div>
  );
}
