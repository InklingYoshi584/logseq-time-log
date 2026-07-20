import { useCallback, useEffect, useRef } from "react";
import type { TimeLogEntry } from "../types";
import TimeGrid from "./TimeGrid";

interface TimeLogViewProps {
  journalDay: number;
  entries: TimeLogEntry[];
  onDropTodo?: (uuid: string, startMinutes: number) => void;
  gridRef?: React.RefObject<HTMLDivElement>;
  loading: boolean;
  hourHeight: number;
  onHourHeightChange: (h: number) => void;
  resizeState: { uuid: string; type: "top" | "bottom"; minutes: number } | null;
  selectedBlockUuid: string | null;
  onSelectBlock: (uuid: string | null) => void;
  onDoubleClickBlock: (uuid: string) => void;
  onDeleteBlock: (uuid: string) => void;
  onDayChange: (day: number) => void;
}

function goToPrevDay(journalDay: number): number {
  const y = Math.floor(journalDay / 10000);
  const m = Math.floor((journalDay % 10000) / 100);
  const d = journalDay % 100;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function goToNextDay(journalDay: number): number {
  const y = Math.floor(journalDay / 10000);
  const m = Math.floor((journalDay % 10000) / 100);
  const d = journalDay % 100;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 1);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function getToday(): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

export default function TimeLogView({
  journalDay,
  entries,
  onDropTodo,
  loading,
  gridRef: propGridRef,
  hourHeight,
  onHourHeightChange,
  resizeState,
  selectedBlockUuid,
  onSelectBlock,
  onDoubleClickBlock,
  onDeleteBlock,
  onDayChange,
}: TimeLogViewProps) {
  const localRef = useRef<HTMLDivElement>(null);
  const gridRef = propGridRef ?? localRef;

  // Zoom: Ctrl+scroll
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        onHourHeightChange(Math.max(30, Math.min(240, hourHeight + (e.deltaY > 0 ? -10 : 10))));
      }
    };
    grid.addEventListener("wheel", onWheel, { passive: false });
    return () => grid.removeEventListener("wheel", onWheel);
  }, []);

  // Day nav
  const handlePrevDay = useCallback(() => {
    onDayChange(goToPrevDay(journalDay));
  }, [journalDay, onDayChange]);

  const handleNextDay = useCallback(() => {
    onDayChange(goToNextDay(journalDay));
  }, [journalDay, onDayChange]);

  const handleToday = useCallback(() => {
    onDayChange(getToday());
  }, [onDayChange]);

  // Scroll to first entry on mount/day change
  useEffect(() => {
    if (entries.length > 0) {
      const first = entries.reduce(
        (min, e) => (e.startMinutes < min ? e.startMinutes : min),
        1440
      );
      const scrollTop = (first / 60) * hourHeight - 20;
      gridRef.current?.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
    } else {
      gridRef.current?.scrollTo({ top: 6 * hourHeight, behavior: "smooth" });
    }
  }, [journalDay, entries.length, hourHeight]);

  // Format day display
  const s = String(journalDay);
  const displayDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  return (
    <div className="time-log-view">
      <div className="time-log-header">
        <button className="time-log-nav-btn" onClick={handlePrevDay}>
          ←
        </button>
        <button className="time-log-today-btn" onClick={handleToday}>
          Today
        </button>
        <span className="time-log-date">{displayDate}</span>
        <button className="time-log-nav-btn" onClick={handleNextDay}>
          →
        </button>
        <div className="time-log-zoom">
          <button
            className="time-log-zoom-btn"
            onClick={() => onHourHeightChange(Math.max(30, hourHeight - 15))}
          >
            −
          </button>
          <span className="time-log-zoom-label">
            {Math.round((hourHeight / 60) * 100)}%
          </span>
          <button
            className="time-log-zoom-btn"
            onClick={() => onHourHeightChange(Math.min(240, hourHeight + 15))}
          >
            +
          </button>
        </div>
      </div>
      {loading ? (
        <p className="todo-empty">Loading...</p>
      ) : (
        <div ref={gridRef} className="time-grid-scroll">
          <TimeGrid
            entries={entries}
            hourHeight={hourHeight}
          onDropTodo={onDropTodo}
            resizeState={resizeState}
            selectedBlockUuid={selectedBlockUuid}
            onSelectBlock={onSelectBlock}
            onDoubleClickBlock={onDoubleClickBlock}
            onDeleteBlock={onDeleteBlock}
          />
        </div>
      )}
    </div>
  );
}
