interface HourMarkersProps {
  hourHeight: number;
}

export default function HourMarkers({ hourHeight }: HourMarkersProps) {
  const markers: { key: string; top: number; label: string | null; major: boolean; half: boolean }[] = [];

  for (let h = 0; h < 24; h++) {
    for (let q = 0; q < 4; q++) {
      const minutes = h * 60 + q * 15;
      const key = `${h}:${q * 15}`;
      const top = (minutes / 60) * hourHeight;

      if (q === 0) {
        // :00 — major label, full-width line
        const label = `${String(h).padStart(2, "0")}:00`;
        markers.push({ key, top, label, major: true, half: false });
      } else if (q === 2) {
        // :30 — minor label, dashed line
        const label = "30";
        markers.push({ key, top, label, major: false, half: true });
      } else if (q === 1) {
        // :15 — quarter, no label but has mark
        markers.push({ key, top, label: "15", major: false, half: false });
      } else if (q === 3) {
        // :45 — quarter, no label but has mark
        markers.push({ key, top, label: "45", major: false, half: false });
      }
    }
  }

  return (
    <div className="time-grid-markers">
      {markers.map((m) => {
        let className = "time-grid-marker";
        if (m.major) className += " time-grid-marker--hour";
        else if (m.half) className += " time-grid-marker--half";
        else className += " time-grid-marker--quarter";

        return (
          <div key={m.key} className={className} style={{ top: `${m.top}px` }}>
            {m.label !== null && <span className="time-grid-label">{m.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
