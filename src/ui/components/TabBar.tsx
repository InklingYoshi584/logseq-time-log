import type { TabId, ViewLayout } from "../types";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  viewLayout: ViewLayout;
  onToggleSplit: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "journal", label: "Journal TODOs" },
  { id: "pages", label: "Page TODOs" },
];

export default function TabBar({
  activeTab,
  onTabChange,
  viewLayout,
  onToggleSplit,
  onRefresh,
  onClose,
}: TabBarProps) {
  return (
    <header className="tab-bar">
      <nav className="tab-bar-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-bar-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="tab-bar-actions">
        <button
          type="button"
          className="tab-bar-btn"
          onClick={onToggleSplit}
          title={viewLayout === "split" ? "Single view" : "Split view"}
        >
          {viewLayout === "split" ? "◫" : "◧"}
        </button>
        <button type="button" className="tab-bar-btn" onClick={onRefresh} title="Refresh">
          ↻
        </button>
        <button type="button" className="tab-bar-btn tab-bar-close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>
    </header>
  );
}
