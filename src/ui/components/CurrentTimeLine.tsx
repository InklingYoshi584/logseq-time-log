interface CurrentTimeLineProps {
  top: number;
  label: string;
 onClickCurrentTime?: () => void;
}

export default function CurrentTimeLine({ top, label, onClickCurrentTime }: CurrentTimeLineProps) {
  return (
    <div className="time-grid-now" style={{ top: `${top}px` }} onClick={onClickCurrentTime}>
      <span className="time-grid-now-label">{label}</span>
      <div className="time-grid-now-dot" />
    </div>
  );
}
