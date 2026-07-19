import { useMemo } from "react";

interface CalendarViewProps {
  daysWithTodos: Set<number>;
  onSelectDay: (day: number) => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Extract all unique years from a set of journal day integers. */
function extractYears(days: Set<number>): number[] {
  const years = new Set<number>();
  for (const d of days) {
    years.add(Math.floor(d / 10000));
  }
  return [...years].sort((a, b) => a - b);
}

/** Generate month grids for a specific year. */
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

export default function CalendarView({ daysWithTodos, onSelectDay }: CalendarViewProps) {
  const years = useMemo(() => extractYears(daysWithTodos), [daysWithTodos]);

  // If no data at all, show current year as fallback
  const displayYears = years.length > 0 ? years : [new Date().getFullYear()];

  return (
    <div className="calendar-view">
      {displayYears.map((year) => {
        const months = useMemo(() => generateYearGrid(year), [year]);
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
    </div>
  );
}

function formatDay(day: number): string {
  const s = String(day);
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  return `${y}-${m}-${d}`;
}
