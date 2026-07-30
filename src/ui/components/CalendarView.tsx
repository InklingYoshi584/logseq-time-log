import { useMemo, useRef, useEffect, useCallback } from "react";

interface CalendarViewProps {
  yearRange: { start: number; end: number };
  daysByYear: Map<number, Set<number>>;
  onSelectDay: (day: number) => void;
  onExpandUp: () => void;
  onExpandDown: () => void;
  onGoToToday: () => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function generateYearGrid(year: number): Array<{ month: number; days: Array<number | null> }> {
  const months: Array<{ month: number; days: Array<number | null> }> = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1).getDay();
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const days: Array<number | null> = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(year * 10000 + (m + 1) * 100 + d);
    }
    months.push({ month: m, days });
  }
  return months;
}

function formatDay(day: number): string {
  const s = String(day);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export default function CalendarView({
  yearRange,
  daysByYear,
  onSelectDay,
  onExpandUp,
  onExpandDown,
  onGoToToday,
}: CalendarViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const expandUpLocked = useRef(false);

  const years: number[] = useMemo(() => {
    const result: number[] = [];
    for (let y = yearRange.start; y <= yearRange.end; y++) {
      result.push(y);
    }
    return result;
  }, [yearRange]);

  const yearGrids = useMemo(() => {
    const map = new Map<number, Array<{ month: number; days: Array<number | null> }>>();
    for (const y of years) {
      map.set(y, generateYearGrid(y));
    }
    return map;
  }, [years]);

  /* ── Unlock upward expansion when years change ── */
  useEffect(() => {
    expandUpLocked.current = false;
  }, [years]);

  /* ── Scroll anchoring: restore position after prepending years ── */
  useEffect(() => {
    if (anchorRef.current && containerRef.current) {
      anchorRef.current.scrollIntoView({ block: "start" });
      anchorRef.current = null;
    }
  }, [years]);

  /* ── Upward expansion via scroll detection ── */
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || expandUpLocked.current) return;

    if (container.scrollTop < 400) {
      expandUpLocked.current = true;
      // Capture first visible year section as scroll anchor
      const sections = container.querySelectorAll<HTMLElement>(".calendar-year-section");
      for (let i = 0; i < sections.length; i++) {
        const rect = sections[i].getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.bottom > containerRect.top) {
          anchorRef.current = sections[i];
          break;
        }
      }
      onExpandUp();
    }
  }, [onExpandUp]);

  /* ── Downward expansion via IntersectionObserver ── */
  useEffect(() => {
    const bottom = bottomSentinel.current;
    if (!bottom) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onExpandDown();
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(bottom);
    return () => observer.disconnect();
  }, [onExpandDown, years]);

  return (
    <div className="calendar-view" ref={containerRef} onScroll={handleScroll}>
      <div className="calendar-toolbar">
        <button type="button" className="calendar-today-btn" onClick={onGoToToday} title="Go to today">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Today
        </button>
      </div>
      {years.map((year) => {
        const daysWithTodos = daysByYear.get(year) ?? new Set<number>();
        const months = yearGrids.get(year) ?? [];

        return (
          <div key={year} className="calendar-year-section">
            <h2 className="calendar-year-heading">{year}</h2>
            <div className="calendar-months">
              {months.map(({ month, days }) => (
                <section key={month} className="calendar-month">
                  <h3 className="calendar-month-heading">{MONTH_NAMES[month]}</h3>
                  <div className="calendar-grid">
                    {DAY_NAMES.map((d) => (
                      <div key={d} className="calendar-day-header">{d}</div>
                    ))}
                    {days.map((day, i) =>
                      day === null ? (
                        <div key={`empty-${i}`} className="calendar-day empty" />
                      ) : daysWithTodos.has(day) ? (
                        <button
                          key={day}
                          type="button"
                          className="calendar-day has-todos"
                          onClick={() => onSelectDay(day)}
                          title={formatDay(day)}
                        >
                          {day % 100}
                        </button>
                      ) : (
                        <button
                          key={day}
                          type="button"
                        className="calendar-day no-todos"
                          onClick={() => onSelectDay(day)}
                          title={formatDay(day)}
                        >
                          {day % 100}
                        </button>
                      )
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        );
      })}

      <div ref={bottomSentinel} className="calendar-sentinel" />
    </div>
  );
}
