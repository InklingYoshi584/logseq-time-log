import { useState } from "react";

export type SearchMode = "active" | "all" | "pages";

interface SearchBarProps {
  onSearch: (query: string, mode: SearchMode) => void;
}

const MODES: { mode: SearchMode; icon: string; title: string }[] = [
  { mode: "active", icon: "[]", title: "Active TODOs (excluding DONE)" },
  { mode: "all", icon: "[v]", title: "All TODOs" },
  { mode: "pages", icon: "📄", title: "Search pages" },
];

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("active");

  const handleChange = (value: string) => {
    setQuery(value);
    onSearch(value, mode);
  };

  const cycleMode = () => {
    const next: SearchMode = mode === "active" ? "all" : mode === "all" ? "pages" : "active";
    setMode(next);
    onSearch(query, next);
  };

  const currentMode = MODES.find((m) => m.mode === mode)!;

  return (
    <div className="search-bar">
      <input
        type="text"
        className="search-input"
        placeholder={mode === "pages" ? "Search pages..." : "Search TODOs..."}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
      />
      <button
        type="button"
        className="search-mode-btn"
        onClick={cycleMode}
        title={currentMode.title}
      >
        {currentMode.icon}
      </button>
    </div>
  );
}
