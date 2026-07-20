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
      {:block/parent [:block/uuid]}
    ])
     :where
     ${noDoneMarkerClause()}]
  `;

 const results = await runQuery(query) as Array<Array<unknown>> | null;
 if (!results || results.length === 0) return [];
 return buildBlockTree(results.flat().map(normalizeTodo));
}

/**
 * Get all journal days (as integers like 20260719) within the given year
 * Get ALL journal days (across all years) that have at least one TODO/DONE block.
 */
export async function queryJournalDaysWithTodos(year: number): Promise<Set<number>> {
 const yStart = year * 10000 + 101;
 const yEnd = year * 10000 + 1231;
 console.log("[time-log] queryJournalDaysWithTodos year:", year, "range:", yStart, yEnd);

 // Days with regular TODO blocks
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
 console.log("[time-log] marker days raw:", raw);
 if (!raw) return new Set<number>();
 const flat = raw.flat(2) as number[];
 const days = new Set(flat.filter((d) => typeof d === "number"));
 console.log("[time-log] marker days set:", [...days]);

 // Also include days with reference blocks
 const extraQueries = [
  `[:find ?day :where [?b :block/content ?content] [(clojure.string/includes? ?content "# Todo")] [?b :block/page ?p] [?p :block/journal-day ?day] [(>= ?day ${yStart})] [(<= ?day ${yEnd})]]`,
  `[:find ?day :where [?b :block/content ?content] [(clojure.string/includes? ?content "((")] [?b :block/page ?p] [?p :block/journal-day ?day] [(>= ?day ${yStart})] [(<= ?day ${yEnd})]]`,
 ];
 for (const q of extraQueries) {
  const raw = await runQuery(q) as number[] | null;
  if (raw) {
   for (const d of raw.flat(2)) {
    if (typeof d === "number") days.add(d);
   }
  }
 }
 console.log("[time-log] merged days:", [...days]);

 return days;
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
      {:block/parent [:block/uuid]}
    ])
     :where
     [?b :block/page ?p]
     [?p :block/journal-day ${journalDay}]
     ${markerClause()}]
  `;

 const results = await runQuery(query) as Array<Array<unknown>> | null;
 const todos = results ? results.flat().map(normalizeTodo) : [];

 // Also find and resolve reference blocks on this day
 const refTodos = await queryAndResolveRefs(journalDay);

 // Deduplicate by uuid
 const seen = new Set(todos.map((t) => t.uuid));
 for (const rt of refTodos) {
  if (!seen.has(rt.uuid)) todos.push(rt);
 }

 // Auto-nest reference blocks based on original parent-child hierarchy
 await autoNestReferences(journalDay);

 return buildBlockTree(todos);
}

async function queryAndResolveRefs(journalDay: number): Promise<TodoBlock[]> {
 const refQuery = `
    [:find (pull ?b [
      :block/uuid
      :block/content
      :block/priority
      {:block/page [:block/name :block/journal-day]}
      {:block/parent [:block/uuid]}
    ])
     :where
     [?b :block/content ?content]
     [(clojure.string/includes? ?content "((")]
     [?b :block/page ?p]
     [?p :block/journal-day ${journalDay}]]
  `;

 const refResults = await runQuery(refQuery) as Array<Array<unknown>> | null;
 if (!refResults || refResults.length === 0) return [];

 const todos: TodoBlock[] = [];

 for (const raw of refResults.flat()) {
  const block = normalizeTodo(raw);
  // Extract UUIDs from ((uuid)) patterns — use matchAll to avoid g-flag lastIndex bugs
  const matches = [...block.content.matchAll(/\(\(([a-f0-9-]+)\)\)/g)];
  for (const match of matches) {
   try {
    const refBlock = await logseq.Editor.getBlock(match[1]);
    if (!refBlock) {
     console.warn("[time-log] getBlock returned null for ref:", match[1]);
     continue;
    }
    if (!refBlock.marker || typeof refBlock.marker !== "string" || !(refBlock.marker in VALID_MARKERS)) {
     console.warn("[time-log] ref block has no valid marker:", match[1], refBlock.marker);
     continue;
    }
    todos.push({
     ...block,
     content: cleanContent(refBlock.content) ?? block.content,
     duration: parseLogbookDuration(refBlock.content) ?? block.duration,
     marker: refBlock.marker as TodoBlock["marker"],
     priority: validatePriority(refBlock.priority),
    });
    break;
   } catch (err) {
    console.warn("[time-log] getBlock threw for ref:", match[1], err);
   }
  }
 }

 return todos;
}

/** Build a tree from flat blocks using parentUuid references. */
export function buildBlockTree(blocks: TodoBlock[]): TodoBlock[] {
 const map = new Map<string, TodoBlock>();
 const roots: TodoBlock[] = [];

 for (const b of blocks) {
  map.set(b.uuid, { ...b, children: [] });
 }

 for (const b of blocks) {
  const node = map.get(b.uuid)!;
  if (b.parentUuid && map.has(b.parentUuid)) {
   map.get(b.parentUuid)!.children!.push(node);
  } else {
   roots.push(node);
  }
 }

 return roots;
}

/**
 * Auto-nest reference blocks on the journal: if reference A and B exist,
 * and on the original page B is a child of A, move B's reference under A's.
 */
export async function autoNestReferences(journalDay: number): Promise<void> {
 // Get all reference blocks on this day
 const refQuery = `
    [:find (pull ?b [
      :block/uuid
      :block/content
      {:block/parent [:block/uuid]}
    ])
     :where
     [?b :block/content ?content]
     [(clojure.string/includes? ?content "((")]
     [?b :block/page ?p]
     [?p :block/journal-day ${journalDay}]]
  `;

 const refResults = await runQuery(refQuery) as Array<Array<unknown>> | null;
 if (!refResults || refResults.length === 0) return;

 // Map: reference-block-uuid → original-block-uuid
 const refMap = new Map<string, string>();
 const uuidRe = /\(\(([a-f0-9-]+)\)\)/g;

 for (const raw of refResults.flat()) {
  const b = normalizeTodo(raw);
  const match = uuidRe.exec(b.content);
  uuidRe.lastIndex = 0;
  if (match) refMap.set(b.uuid, match[1]);
 }

 // For each reference, check if original has a parent that also has a reference
 for (const [refUuid, origUuid] of refMap) {
  try {
   const origBlock = await logseq.Editor.getBlock(origUuid);
   if (!origBlock?.parent) continue;
   const parentOrigUuid = typeof origBlock.parent === "string"
    ? origBlock.parent
    : (origBlock.parent as { uuid?: string })?.uuid;
   if (!parentOrigUuid) continue;

   // Find reference for the parent
   let parentRefUuid: string | undefined;
   for (const [rUuid, oUuid] of refMap) {
    if (oUuid === parentOrigUuid) { parentRefUuid = rUuid; break; }
   }
   if (!parentRefUuid || parentRefUuid === refUuid) continue;

   // Check if already nested
   const refBlock = await logseq.Editor.getBlock(refUuid);
   if (refBlock?.parent && typeof refBlock.parent !== "string") {
    const currentParent = (refBlock.parent as { uuid?: string })?.uuid;
    if (currentParent === parentRefUuid) continue; // already nested
   }

   // Move reference under parent reference
   await logseq.Editor.moveBlock(refUuid, parentRefUuid, { children: true });
   console.log("[time-log] nested ref", refUuid, "under", parentRefUuid);
  } catch (err) {
   console.warn("[time-log] autoNestReferences failed for", refUuid, err);
  }
 }
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

 const parent = block.parent && typeof block.parent === "object"
  ? block.parent as Record<string, unknown>
  : null;

 return {
  uuid: String(block.uuid ?? ""),
  content: cleanContent(String(block.content ?? "")),
  marker: validateMarker(block.marker),
  priority: validatePriority(block.priority),
  parentUuid: parent?.uuid ? String(parent.uuid) : undefined,
  duration: parseLogbookDuration(String(block.content ?? "")),
  page: {
   name: String(page.name ?? "Unknown"),
   journalDay: typeof page["journal-day"] === "number"
    ? page["journal-day"] as number
    : null,
   journal: page["journal?"] === true,
  },
 };
}

/** Strip block properties like `id:: uuid` from display content. */
function cleanContent(raw: string | null | undefined): string {
 if (!raw) return "";
 // Strip :LOGBOOK: ... :END: drawer
 let s = raw.replace(/:\s*LOGBOOK\s*:[\s\S]*?:\s*END\s*:/gi, "").replace(/\s*\w+::\s*\S+/g, "").trim();
 // Strip marker prefix (TODO, DOING, DONE, NOW, LATER, WAITING)
 s = s.replace(/^(TODO|DOING|DONE|NOW|LATER|WAITING)\s+/i, "");
 return s;
}

/** Parse total duration from LOGBOOK CLOCK entries. Returns "HH:MM:SS" or undefined. */
export function parseLogbookDuration(raw: string | null | undefined): string | undefined {
 if (!raw) return undefined;
 const match = raw.match(/:\s*LOGBOOK\s*:([\s\S]*?):\s*END\s*:/i);
 if (!match) return undefined;
 const clocks = match[1].match(/=>\s*(\d{2}):(\d{2}):(\d{2})/g);
 if (!clocks || clocks.length === 0) return undefined;
 let totalSec = 0;
 for (const c of clocks) {
  const parts = c.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (parts) {
   totalSec += parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
  }
 }
 if (totalSec === 0) return undefined;
 const h = Math.floor(totalSec / 3600);
 const m = Math.floor((totalSec % 3600) / 60);
 const s = totalSec % 60;
 return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

export async function moveTodoToJournal(blockUuid: string, targetDay?: number): Promise<number> {
 let journalDay: number;
 let pageName: string;
 try {
  const stateToday = await logseq.App.getStateFromStore("today") as unknown;
  console.log("[time-log] raw state today:", stateToday, typeof stateToday);
  if (typeof stateToday === "string") {
   // Use the state string as the page name directly (respects user's date format)
   pageName = stateToday;
   const parsed = new Date(stateToday);
   if (!isNaN(parsed.getTime())) {
    journalDay = parsed.getFullYear() * 10000 + (parsed.getMonth() + 1) * 100 + parsed.getDate();
   } else {
    // Can't parse — fall back to JS Date for journalDay, keep state string as pageName
    const d = new Date();
    journalDay = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
   }
  } else if (typeof stateToday === "number" && stateToday > 20000101) {
   journalDay = stateToday;
   const yyyy = Math.floor(journalDay / 10000);
   const mm = String(Math.floor((journalDay % 10000) / 100)).padStart(2, "0");
   const dd = String(journalDay % 100).padStart(2, "0");
   pageName = `${yyyy}${mm}${dd}`;
  } else {
   throw new Error("no valid today in state");
  }
 } catch {
  const d = new Date();
  journalDay = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const yyyy = Math.floor(journalDay / 10000);
  const mm = String(Math.floor((journalDay % 10000) / 100)).padStart(2, "0");
  const dd = String(journalDay % 100).padStart(2, "0");
  pageName = `${yyyy}${mm}${dd}`;
 }
 console.log("[time-log] resolved journalDay:", journalDay);

 console.log("[time-log] moveTodoToJournal:", { blockUuid, journalDay, pageName });

 // Determine target page: use targetDay if provided, otherwise today
 const effectiveDay = targetDay ?? journalDay;
 const effectivePageName = await resolveJournalPageName(effectiveDay) ?? pageName;

 console.log("[time-log] inserting into:", { effectiveDay, effectivePageName });

 // Ensure the page exists as a journal page (sets :block/journal-day)
 await logseq.Editor.createPage(effectivePageName, {}, {
  journal: true,
  createFirstBlock: false,
 });

 const todosBlockUuid = await findOrCreateTodosBlock(effectivePageName);
 const result = await logseq.Editor.insertBlock(todosBlockUuid, `((${blockUuid}))`, {
  sibling: false,
 });
 console.log("[time-log] insertBlock result:", result);

 try {
  await logseq.Editor.setBlockCollapsed(todosBlockUuid, { flag: false });
 } catch { }

 return effectiveDay;
}

async function resolveJournalPageName(day: number): Promise<string | null> {
 const query = `
    [:find (pull ?p [:block/name]) .
     :where
     [?p :block/journal-day ${day}]]
  `;
 const result = await runQuery(query) as { name: string } | null;
 return result?.name ?? null;
}

async function findOrCreateTodosBlock(pageName: string): Promise<string> {
 try {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  for (const block of blocks) {
   if (block.content && typeof block.content === "string" && block.content.includes("# Todo")) {
    return block.uuid;
   }
  }
 } catch (err) {
  console.warn("[time-log] getPageBlocksTree failed, creating new # Todo:", err);
 }

 const block = await logseq.Editor.insertBlock(pageName, "# Todo", {
  isPageBlock: true,
  sibling: true,
  properties: {},
 });
 return block?.uuid ?? "";
}


/* ── Delete ── */

/** Update a block's TODO marker. */
export async function changeMarker(blockUuid: string, marker: string): Promise<void> {
 const block = await logseq.Editor.getBlock(blockUuid);
 const content: string = typeof block?.content === "string" ? block.content : "";

 // If this is a reference block, resolve to the original
 if (content && typeof content === "string") {
  const match = content.match(/\(\(([a-f0-9-]+)\)\)/);
  if (match) {
   const orig = await logseq.Editor.getBlock(match[1]);
   if (orig?.content && typeof orig.content === "string") {
    await logseq.Editor.updateBlock(match[1], setMarkerPrefix(orig.content, marker));
   }
   return;
  }
 }
 // Not a reference — update block content with new marker prefix
 const newContent = setMarkerPrefix(content, marker);
 await logseq.Editor.updateBlock(blockUuid, newContent);
}

/** Replace the TODO/DOING/DONE prefix in block content. */
function setMarkerPrefix(content: string, marker: string): string {
 const prefixes = ["TODO", "DOING", "DONE", "NOW", "LATER", "WAITING"];
 for (const p of prefixes) {
  if (content.startsWith(p + " ")) return marker + " " + content.slice(p.length + 1);
  if (content === p) return marker;
 }
 // No prefix found — prepend
 return marker + " " + content;
}

/** Delete a single block from the journal page. */
export async function deleteJournalBlock(blockUuid: string): Promise<void> {
 await logseq.Editor.removeBlock(blockUuid);
}

/** Delete a TODO and all blocks that reference it. */
export async function deleteTodoWithRefs(blockUuid: string): Promise<void> {
 // Find all blocks that contain a reference to this block
 const query = `
    [:find (pull ?b [:block/uuid]) ?content
     :where
     [?b :block/content ?content]
     [(clojure.string/includes? ?content "((${blockUuid}))")]]
  `;
 const refs = await runQuery(query) as Array<[{ uuid: string }, string]> | null;

 // Delete all referencing blocks
 if (refs) {
  for (const [block] of refs) {
   if (block?.uuid) {
    try { await logseq.Editor.removeBlock(block.uuid); } catch { }
   }
  }
 }

 // Delete the original block
 await logseq.Editor.removeBlock(blockUuid);
}

/** Group TODOs on a page by their nearest non-TODO ancestor (title block). */
export async function queryPageTodosGroupedByTitle(pageName: string): Promise<Array<{ title: string; todos: TodoBlock[] }>> {
 const blocks = await logseq.Editor.getPageBlocksTree(pageName);
 if (!blocks || blocks.length === 0) return [];

 const groups = new Map<string, TodoBlock[]>();
 const KEY_UNCATEGORIZED = "__uncategorized__";

 function walk(children: Array<Record<string, unknown>> | undefined, title: string | null) {
  if (!children) return;
  for (const child of children) {
   const marker = child.marker as string | undefined;
   // If this block is a TODO, add it under the current title
   if (marker && typeof marker === "string" && marker in VALID_MARKERS) {
    const key = title ?? KEY_UNCATEGORIZED;
    const group = groups.get(key);
    const todo: TodoBlock = {
     uuid: String(child.uuid ?? ""),
     content: cleanContent(String(child.content ?? "")),
     marker: marker as TodoBlock["marker"],
     priority: validatePriority(child.priority),
     page: { name: pageName, journalDay: null, journal: false },
    };
    if (group) {
     group.push(todo);
    } else {
     groups.set(key, [todo]);
    }
    // Continue walking children — the title stays the same for nested TODOs
    walk(child.children as Array<Record<string, unknown>> | undefined, title);
   } else {
    // Not a TODO — this becomes the new title for its children
    const newTitle = cleanContent(String(child.content ?? ""));
    walk(child.children as Array<Record<string, unknown>> | undefined, newTitle);
   }
  }
 }

 walk(blocks as Array<Record<string, unknown>>, null);

 const result: Array<{ title: string; todos: TodoBlock[] }> = [];
 // Uncategorized first
 const uncat = groups.get(KEY_UNCATEGORIZED);
 if (uncat) result.push({ title: "", todos: uncat });
 for (const [title, todos] of groups) {
  if (title !== KEY_UNCATEGORIZED) result.push({ title, todos });
 }

 return result;
}

export function sortJournalTodos(todos: TodoBlock[]): TodoBlock[] {
 return [...todos].sort((a, b) => (b.page.journalDay ?? 0) - (a.page.journalDay ?? 0));
}

export function sortPageTodos(todos: TodoBlock[]): TodoBlock[] {
 return [...todos].sort((a, b) => a.page.name.localeCompare(b.page.name));
}
