interface CurrentTimeLineProps {
  top: number;
  label: string;
}

export default function CurrentTimeLine({ top, label }: CurrentTimeLineProps) {
  return (
    <div className="time-grid-now" style={{ top: `${top}px` }}>
      <span className="time-grid-now-label">{label}</span>
      <div className="time-grid-now-dot" />
    </div>
  );
}
