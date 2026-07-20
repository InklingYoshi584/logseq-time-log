export type TodoMarker = "TODO" | "DOING" | "NOW" | "LATER" | "WAITING" | "DONE";

export type TodoPriority = "A" | "B" | "C";

export interface PageRef {
  name: string;
  journalDay: number | null;
  journal: boolean;
}

export interface TodoBlock {
  uuid: string;
  content: string;
  marker: TodoMarker;
  priority: TodoPriority | null;
  page: PageRef;
  parentUuid?: string;
  children?: TodoBlock[];
  duration?: string; // total time from LOGBOOK, e.g. "00:15:30"
}

export type AppTab = "tasks" | "timelog";
export type ViewLayout = "single" | "split";

/* ── Time Log ── */

export interface TimeLogEntry {
  uuid: string;
  startMinutes: number;
  endMinutes: number;
  activity: string;
  todoUuid?: string;
  isClockEntry: boolean;
}

export type DragItemType =
  | "journal-todo"
  | "time-block"
  | "time-block-top"
  | "time-block-bottom"
  | "create-selection";

export interface DragData {
  type: DragItemType;
  uuid?: string;
  startMinutes?: number;
  endMinutes?: number;
}

export interface TimePreset {
  id: string;
  label: string;
  minutes: number;
}
