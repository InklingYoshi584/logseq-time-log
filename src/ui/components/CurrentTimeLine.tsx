interface CurrentTimeLineProps {
  top: number;
}

export default function CurrentTimeLine({ top }: CurrentTimeLineProps) {
  return (
    <div className="time-grid-now" style={{ top: `${top}px` }}>
      <div className="time-grid-now-dot" />
    </div>
  );
}
