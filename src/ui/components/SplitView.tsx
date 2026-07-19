import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";

interface SplitViewProps {
  left: ReactNode;
  right: ReactNode;
}

export default function SplitView({ left, right }: SplitViewProps) {
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(20, Math.min(80, (x / rect.width) * 100));
      setSplitPercent(percent);
    };

    const handleMouseUp = () => {
      dragging.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div className="split-view" ref={containerRef}>
      <div
        className="split-pane split-pane-left"
        style={{ width: `${splitPercent}%` }}
      >
        {left}
      </div>
      <div className="split-divider" onMouseDown={handleMouseDown} />
      <div className="split-pane split-pane-right">
        {right}
      </div>
    </div>
  );
}
