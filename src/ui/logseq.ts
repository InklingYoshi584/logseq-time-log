import type { TodoBlock, TodoMarker, TodoPriority } from "./types";

/* ── Marker & priority ordering ── */

const MARKER_ORDER: Record<string, number> = {
  DOING: 0,
  TODO: 1,
  DONE: 2,
  NOW: 3,
  LATER: 4,
  WAITING: 5,
};

const PRIORITY_ORDER: Record<string, number> = {
  "": 0,
  A: 1,
  B: 2,
  C: 3,
};

function priorityKey(p: TodoPriority | null): string {
  return p ?? "";
}

/* ── Datalog helpers ── */

function markerClause(): string {
  return `(or
       [?b :block/marker "TODO"]
       [?b :block/marker "DOING"]
       [?b :block/marker "NOW"]
       [?b :block/marker "LATER"]
       [?b :block/marker "WAITING"]
       [?b :block/marker "DONE"])`;
}

function noDoneMarkerClause(): string {
  return `(or
       [?b :block/marker "TODO"]
       [?b :block/marker "DOING"]
       [?b :block/marker "NOW"]
       [?b :block/marker "LATER"]
       [?b :block/marker "WAITING"])`;
}

/* ── Queries ── */

/**
 * Query all non-DONE TODO blocks (for the Page TODOs tab).
 */
export async function queryAllTodos(): Promise<TodoBlock[]> {
  const query = `
    [:find (pull ?b [
      :block/uuid
      :block/content
      :block/marker
      :block/priority
      {:block/page [:block/name :block/journal? :block/journal-day]}
    ])
     :where
     ${noDoneMarkerClause()}]
  `;

  const results = await runQuery(query) as Array<Array<unknown>> | null;
  if (!results || results.length === 0) return [];
  return results.flat().map(normalizeTodo);
}

/**
 * Get all journal days (as integers like 20260719) within the given year
 * that have at least one TODO/DONE block.
 */
export async function queryJournalDaysWithTodos(year: number): Promise<Set<number>> {
  const yStart = year * 10000 + 101;
  const yEnd = year * 10000 + 1231;

  const query = `
    [:find ?day
     :where
     [?b :block/marker ?m]
     [?b :block/page ?p]
     [?p :block/journal-day ?day]
     [(>= ?day ${yStart})]
     [(<= ?day ${yEnd})]]
  `;

  const raw = await runQuery(query) as number[] | null;
  if (!raw) return new Set<number>();
  // Defensive: the result may be nested [day, day, ...] or [[day], [day], ...]
  const flat = raw.flat(2) as number[];
  return new Set(flat.filter((d) => typeof d === "number"));
}

/**
 * Query all TODO/DONE blocks for a specific journal day.
 */
export async function queryDayTodos(journalDay: number): Promise<TodoBlock[]> {
  const query = `
    [:find (pull ?b [
      :block/uuid
      :block/content
      :block/marker
      :block/priority
      {:block/page [:block/name :block/journal-day]}
    ])
     :where
     [?b :block/page ?p]
     [?p :block/journal-day ${journalDay}]
     ${markerClause()}]
  `;

  const results = await runQuery(query) as Array<Array<unknown>> | null;
  if (!results || results.length === 0) return [];
  return results.flat().map(normalizeTodo);
}

async function runQuery(query: string): Promise<unknown[] | null> {
  try {
    const results = await logseq.DB.datascriptQuery(query);
    console.log("[time-log] query result:", results);
    return results;
  } catch (err) {
    console.error("[time-log] datascriptQuery threw:", err);
    return null;
  }
}

/* ── Normalization ── */

function normalizeTodo(raw: unknown): TodoBlock {
  if (!raw || typeof raw !== "object") {
    return emptyTodo();
  }
  const block = raw as Record<string, unknown>;
  const page = block.page && typeof block.page === "object"
    ? block.page as Record<string, unknown>
    : {};

  return {
    uuid: String(block.uuid ?? ""),
    content: String(block.content ?? ""),
    marker: validateMarker(block.marker),
    priority: validatePriority(block.priority),
    page: {
      name: String(page.name ?? "Unknown"),
      journalDay: typeof page["journal-day"] === "number"
        ? page["journal-day"] as number
        : null,
      journal: page["journal?"] === true,
    },
  };
}

function emptyTodo(): TodoBlock {
  return {
    uuid: "",
    content: "",
    marker: "TODO",
    priority: null,
    page: { name: "Unknown", journalDay: null, journal: false },
  };
}

const VALID_MARKERS: Record<string, TodoBlock["marker"]> = {
  TODO: "TODO",
  DOING: "DOING",
  NOW: "NOW",
  LATER: "LATER",
  WAITING: "WAITING",
  DONE: "DONE",
};

function validateMarker(raw: unknown): TodoBlock["marker"] {
  if (typeof raw === "string" && raw in VALID_MARKERS) {
    return VALID_MARKERS[raw];
  }
  return "TODO";
}

function validatePriority(raw: unknown): TodoBlock["priority"] {
  if (raw === "A" || raw === "B" || raw === "C") return raw;
  return null;
}

/* ── Grouping & sorting ── */

export function groupTodos(todos: TodoBlock[]) {
  return {
    journal: todos.filter((t) => t.page.journal),
    pages: todos.filter((t) => !t.page.journal),
  };
}

/**
 * Sort a day's TODOs for DayDetail display:
 * within each priority (None, A, B, C), order by marker:
 * DOING → TODO → DONE, then NOW → LATER → WAITING
 */
export function sortDayTodos(todos: TodoBlock[]): TodoBlock[] {
  return [...todos].sort((a, b) => {
    const pA = PRIORITY_ORDER[priorityKey(a.priority)] ?? 0;
    const pB = PRIORITY_ORDER[priorityKey(b.priority)] ?? 0;
    if (pA !== pB) return pA - pB;

    const mA = MARKER_ORDER[a.marker] ?? 99;
    const mB = MARKER_ORDER[b.marker] ?? 99;
    return mA - mB;
  });
}

/**
 * Group day TODOs by priority for rendering sections.
 * Returns [priority label, todos][] ordered None → A → B → C.
 */
export function groupDayTodosByPriority(todos: TodoBlock[]): Array<[string, TodoBlock[]]> {
  const map = new Map<string, TodoBlock[]>();
  for (const t of todos) {
    const key = priorityKey(t.priority);
    const group = map.get(key);
    if (group) {
      group.push(t);
    } else {
      map.set(key, [t]);
    }
  }

  const order = ["", "A", "B", "C"];
  const result: Array<[string, TodoBlock[]]> = [];
  for (const k of order) {
    const items = map.get(k);
    if (items && items.length > 0) {
      result.push([k === "" ? "No priority" : `Priority ${k}`, items]);
    }
  }
  return result;
}

/* ── Move to journal ── */

export async function moveTodoToJournal(blockUuid: string): Promise<void> {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const todayPage = `${yyyy}${mm}${dd}`;
  const todosBlockUuid = await findOrCreateTodosBlock(todayPage);

  await logseq.Editor.insertBlock(todosBlockUuid, `((${blockUuid}))`, {
    sibling: false,
  });
}

async function findOrCreateTodosBlock(pageName: string): Promise<string> {
  const query = `
    [:find (pull ?b [:block/uuid]) .
     :where
     [?b :block/page ?p]
     [?p :block/name "${pageName}"]
     [?b :block/content ?content]
     [(clojure.string/includes? ?content "# Todos")]]
  `;

  const existing = (await runQuery(query)) as Array<{ uuid: string }> | null;

  if (existing && existing.length > 0 && existing[0]?.uuid) {
    return existing[0].uuid;
  }

  const block = await logseq.Editor.insertBlock(pageName, "# Todos", {
    isPageBlock: true,
    sibling: true,
    properties: {},
  });

  return block?.uuid ?? "";
}

export function sortJournalTodos(todos: TodoBlock[]): TodoBlock[] {
  return [...todos].sort((a, b) => (b.page.journalDay ?? 0) - (a.page.journalDay ?? 0));
}

export function sortPageTodos(todos: TodoBlock[]): TodoBlock[] {
  return [...todos].sort((a, b) => a.page.name.localeCompare(b.page.name));
}
