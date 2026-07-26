import { useDraggable } from "@dnd-kit/core";
import { useCallback, useRef } from "react";
import type { TimeLogEntry } from "../types";

interface TimeBlockProps {
  entry: TimeLogEntry;
  style: React.CSSProperties;
  displayStart?: number;
  displayEnd?: number;
  isSelected: boolean;
  isEditing?: boolean;
  onClickBlock?: (uuid: string) => void;
  onRename?: (uuid: string, name: string) => void;
  onSelect: (uuid: string) => void;
  onDoubleClick: (uuid: string) => void;
  onDelete: (uuid: string) => void;
}

function formatHM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default function TimeBlock({
  entry, style, displayStart, displayEnd, isSelected, isEditing,
  onClickBlock, onRename, onSelect, onDoubleClick, onDelete,
}: TimeBlockProps) {
  const actualHeight = parseFloat(String(style.height)) || 0;
  // Dynamic font: scale with block height, clamped
  const fontSize = Math.max(8, Math.min(14, actualHeight / 3.5));
  const showActivity = actualHeight >= 22;
  const bodyStyle: React.CSSProperties = { fontSize: `${fontSize}px`, lineHeight: 1.15 };

  const isOpenEnded = entry.endMinutes === null;

  const {
    attributes: bodyAttrs,
    listeners: bodyListeners,
    setNodeRef: bodyRef,
  } = useDraggable({
    id: entry.uuid,
    disabled: isOpenEnded,
    data: {
      type: "time-block",
      uuid: entry.uuid,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      isScheduled: entry.isScheduled,
      isScheduledStart: entry.isScheduledStart,
      isScheduledEnd: entry.isScheduledEnd,
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
      isScheduled: entry.isScheduled,
      isScheduledStart: entry.isScheduledStart,
      isScheduledEnd: entry.isScheduledEnd,
    },
  });

  const {
    attributes: bottomAttrs,
    listeners: bottomListeners,
    setNodeRef: bottomRef,
  } = useDraggable({
    id: `${entry.uuid}-bottom`,
    disabled: isOpenEnded,
    data: {
      type: "time-block-bottom",
      uuid: entry.uuid,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      isScheduled: entry.isScheduled,
      isScheduledStart: entry.isScheduledStart,
      isScheduledEnd: entry.isScheduledEnd,
    },
  });

  // Click vs drag detection for open-ended blocks
  const pointerStartRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY, shiftKey: e.shiftKey } as { x: number; y: number; shiftKey: boolean };
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!onClickBlock) return;
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const isInProgress = entry.isScheduled && nowMins >= entry.startMinutes;
    if (!isOpenEnded && !(isInProgress && pointerStartRef.current.shiftKey)) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
      onClickBlock(entry.uuid);
    }
  }, [isOpenEnded, entry.isScheduled, entry.startMinutes, onClickBlock, entry.uuid]);

  let colorClass: string;
  if (entry.isClockEntry) {
    colorClass = "time-block--clock";
  } else if (entry.todoUuid) {
    colorClass = "time-block--task";
  } else {
    colorClass = "time-block--event";
  }

  // Compute in-progress percentage for scheduled blocks
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const isInProgress = entry.isScheduled && nowMins >= entry.startMinutes && (entry.endMinutes === null || nowMins < entry.endMinutes);
  let progressPct = 100;
  if (isInProgress && entry.endMinutes !== null) {
    progressPct = Math.round(((nowMins - entry.startMinutes) / (entry.endMinutes - entry.startMinutes)) * 100);
  }

  const classes = [
    "time-block",
    colorClass,
    isSelected ? "time-block--selected" : "",
    actualHeight < 15 ? "time-block--thin" : "",
    entry.isScheduled ? "time-block--scheduled" : "",
    isInProgress ? "time-block--in-progress" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const timeLabel = isOpenEnded
    ? `${formatHM(displayStart ?? entry.startMinutes)} - ...`
    : `${formatHM(displayStart ?? entry.startMinutes)} - ${formatHM(displayEnd ?? entry.endMinutes ?? 0)}`;

  const showErrorBadge = entry.errorMinutes !== undefined && entry.errorMinutes !== 0;
  let errorBadgeLabel = "";
  if (showErrorBadge) {
    const sign = entry.errorMinutes! > 0 ? "+" : "";
    const abs = Math.abs(entry.errorMinutes!);
    errorBadgeLabel = `(${sign}${abs})`;
  }

  return (
    <div
      className={classes}
      data-block-uuid={entry.uuid}
      style={isInProgress ? { ...style, "--progress-pct": `${progressPct}%` } as React.CSSProperties : style}
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
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
                onBlur={(e) => onRename?.(entry.uuid, e.target.value.trim())}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") onRename?.(entry.uuid, (e.target as HTMLInputElement).value.trim());
                  if (e.key === "Escape") onRename?.(entry.uuid, entry.activity);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="time-block-time">
                  {timeLabel}
                </span>
                {showActivity && (
                  <span className="time-block-activity">{entry.activity}</span>
                )}
                {showErrorBadge && (
                  <span className="time-block-error-badge">{errorBadgeLabel}</span>
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
      {!isOpenEnded && (
        <div
          className="time-block-handle time-block-handle--bottom"
          ref={bottomRef}
          {...bottomListeners}
          {...bottomAttrs}
        />
      )}
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
