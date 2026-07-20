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

export type TabId = "journal" | "pages";

export type ViewLayout = "single" | "split";
