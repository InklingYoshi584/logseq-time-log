import type { AppTab } from "../types";

interface HeaderBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export default function HeaderBar({ activeTab, onTabChange, onRefresh, onClose }: HeaderBarProps) {
  return (
    <header className="header-bar">
      <nav className="header-bar-tabs">
        <button type="button"
          className={`header-bar-tab${activeTab === "tasks" ? " active" : ""}`}
          onClick={() => onTabChange("tasks")}>Tasks</button>
        <button type="button"
          className={`header-bar-tab${activeTab === "timelog" ? " active" : ""}`}
          onClick={() => onTabChange("timelog")}>Time Log</button>
      </nav>
      <span className="header-bar-title">Time Log</span>
      <div className="header-bar-actions">
        <button type="button" className="header-bar-btn" onClick={onRefresh} title="Refresh">↻</button>
        <button type="button" className="header-bar-btn header-bar-close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
    </header>
  );
}
