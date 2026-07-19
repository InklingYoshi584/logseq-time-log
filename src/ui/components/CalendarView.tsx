import { useMemo, useRef, useEffect } from "react";

interface CalendarViewProps {
  yearRange: { start: number; end: number };
  daysByYear: Map<number, Set<number>>;
  onSelectDay: (day: number) => void;
  onExpandUp: () => void;
  onExpandDown: () => void;
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
}: CalendarViewProps) {
  const topSentinel = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const top = topSentinel.current;
    const bottom = bottomSentinel.current;
    if (!top || !bottom) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === top) onExpandUp();
          if (entry.target === bottom) onExpandDown();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [onExpandUp, onExpandDown, years]);

  return (
    <div className="calendar-view">
      <div ref={topSentinel} className="calendar-sentinel" />

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
                        <div key={day} className="calendar-day no-todos">
                          {day % 100}
                        </div>
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
