import { useDraggable } from "@dnd-kit/core";
import type { TimeLogEntry } from "../types";

interface TimeBlockProps {
  entry: TimeLogEntry;
  style: React.CSSProperties;
  displayStart?: number;
  displayEnd?: number;
  isSelected: boolean;
  isEditing?: boolean;
  onRename?: (uuid: string, name: string) => void;
  onSelect: (uuid: string) => void;
  onDoubleClick: (uuid: string) => void;
  onDelete: (uuid: string) => void;
}

function formatHM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default function TimeBlock({ entry, style, displayStart, displayEnd, isSelected, isEditing, onRename, onSelect, onDoubleClick, onDelete }: TimeBlockProps) {
  const actualHeight = parseFloat(String(style.height)) || 0;
  // Dynamic font: scale with block height, clamped
  const fontSize = Math.max(8, Math.min(14, actualHeight / 3.5));
  const showActivity = actualHeight >= 22;
  const bodyStyle: React.CSSProperties = { fontSize: `${fontSize}px`, lineHeight: 1.15 };

  const {
    attributes: bodyAttrs,
    listeners: bodyListeners,
    setNodeRef: bodyRef,
  } = useDraggable({
    id: entry.uuid,
    data: {
      type: "time-block",
      uuid: entry.uuid,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
    },
  });

  const {
    attributes: topAttrs,
    listeners: topListeners,
    setNodeRef: topRef,
  } = useDraggable({
    id: `${entry.uuid}-top`,
    data: {
      type: "time-block-top",
      uuid: entry.uuid,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
    },
  });

  const {
    attributes: bottomAttrs,
    listeners: bottomListeners,
    setNodeRef: bottomRef,
  } = useDraggable({
    id: `${entry.uuid}-bottom`,
    data: {
      type: "time-block-bottom",
      uuid: entry.uuid,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
    },
  });

  let colorClass: string;
  if (entry.isClockEntry) {
    colorClass = "time-block--clock";
  } else if (entry.todoUuid) {
    colorClass = "time-block--task";
  } else {
    colorClass = "time-block--event";
  }

  const classes = [
    "time-block",
    colorClass,
    isSelected ? "time-block--selected" : "",
    actualHeight < 15 ? "time-block--thin" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-block-uuid={entry.uuid}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(entry.uuid);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(entry.uuid);
      }}
    >
      <div
        className="time-block-handle time-block-handle--top"
        ref={topRef}
        {...topListeners}
        {...topAttrs}
      />
      <div
        className="time-block-body"
        ref={bodyRef}
        style={bodyStyle}
        {...bodyListeners}
        {...bodyAttrs}
      >
        {actualHeight >= 8 && (
          <>
            {isEditing ? (
              <input
                className="time-block-edit-input"
                defaultValue={entry.activity}
                autoFocus
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                    if (data.content) {
                      (e.target as HTMLInputElement).value = data.content;
                    }
                  } catch { /* ignore */ }
                }}
                onBlur={(e) => onRename?.(entry.uuid, e.target.value.trim() || entry.activity)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRename?.(entry.uuid, (e.target as HTMLInputElement).value.trim() || entry.activity);
                  if (e.key === "Escape") onRename?.(entry.uuid, entry.activity);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="time-block-time">
                  {formatHM(displayStart ?? entry.startMinutes)} - {formatHM(displayEnd ?? entry.endMinutes)}
                </span>
                {showActivity && (
                  <span className="time-block-activity">{entry.activity}</span>
                )}
              </>
            )}
            {entry.isClockEntry && (
              <span className="time-block-icon">🕐</span>
            )}
            {entry.todoUuid && !entry.isClockEntry && (
              <span className="time-block-icon">📋</span>
            )}
            {!entry.todoUuid && !entry.isClockEntry && (
              <span className="time-block-icon">📅</span>
            )}
          </>
        )}
      </div>
      <div
        className="time-block-handle time-block-handle--bottom"
        ref={bottomRef}
        {...bottomListeners}
        {...bottomAttrs}
      />
      {isSelected && (
        <button
          className="time-block-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.uuid);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
