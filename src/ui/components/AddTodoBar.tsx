import { useState } from "react";

interface AddTodoBarProps {
  onAdd: (text: string, priority: string) => void;
}

const PRIORITIES = ["", "A", "B", "C"];
const PRIORITY_LABELS: Record<string, string> = { "": "?", "A": "A", "B": "B", "C": "C" };

export default function AddTodoBar({ onAdd }: AddTodoBarProps) {
  const [text, setText] = useState("");
  const [priorityIndex, setPriorityIndex] = useState(0);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, PRIORITIES[priorityIndex]);
    setText("");
  };

  const cyclePriority = () => {
    setPriorityIndex((i) => (i + 1) % PRIORITIES.length);
  };

  const currentPriority = PRIORITIES[priorityIndex];

  return (
    <div className="add-todo-bar">
      <button
        type="button"
        className="add-todo-priority"
        onClick={cyclePriority}
        title={`Priority: ${PRIORITY_LABELS[currentPriority]}`}
      >
        {PRIORITY_LABELS[currentPriority]}
      </button>
      <input
        type="text"
        className="add-todo-input"
        placeholder="Add TODO..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
      />
      <button type="button" className="add-todo-btn" onClick={handleSubmit}>
        +
      </button>
    </div>
  );
}
