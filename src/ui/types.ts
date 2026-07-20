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
}

export type TabId = "journal" | "pages";

export type ViewLayout = "single" | "split";
