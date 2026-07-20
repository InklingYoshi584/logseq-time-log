interface HeaderBarProps {
  onRefresh: () => void;
  onClose: () => void;
}

export default function HeaderBar({ onRefresh, onClose }: HeaderBarProps) {
  return (
    <header className="header-bar">
      <span className="header-bar-title">Time Log</span>
      <div className="header-bar-actions">
        <button type="button" className="header-bar-btn" onClick={onRefresh} title="Refresh">
          ↻
        </button>
        <button type="button" className="header-bar-btn header-bar-close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>
    </header>
  );
}
