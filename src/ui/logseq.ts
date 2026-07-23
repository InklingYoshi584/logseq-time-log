import type { TimeLogEntry, TodoBlock, TodoPriority } from "./types";

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

const MONTH_ABBR: Record<string, number> = {
 jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse Logseq date strings like "Jul 20th, 2026" into an integer YYYYMMDD. */
export function parseLogseqDate(raw: unknown): number | null {
 if (typeof raw !== "string") return null;
 const match = raw.match(/(\w{3})\s+(\d+)\w*,?\s*(\d{4})/i);
 if (!match) return null;
 const month = MONTH_ABBR[match[1].toLowerCase()];
 if (!month) return null;
 const day = parseInt(match[2], 10);
 const year = parseInt(match[3], 10);
 return year * 10000 + month * 100 + day;
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
export async function queryDayTodos(journalDay: number, preserveOrder?: boolean): Promise<TodoBlock[]> {
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

 const tree = buildBlockTree(todos);

 // Resolve page name for # Todo filtering
 const pageQuery = `
    [:find (pull ?p [:block/name]) .
     :where
     [?p :block/journal-day ${journalDay}]]
 `;
 const pageResult = await runQuery(pageQuery) as { name: string } | null;
 const pageName = pageResult?.name ?? null;

 // Filter: only show TODOs that are descendants of the # Todo block
 const filtered = filterUnderTodo(pageName, tree);
 return filtered;
}

/** Find TODOs on a journal page that are NOT under the # Todo block. */
export async function findOrphanTodos(pageName: string): Promise<TodoBlock[]> {
 const blocks = await logseq.Editor.getPageBlocksTree(pageName);
 if (!blocks || blocks.length === 0) return [];

 // Find the # Todo block
 const orphans: TodoBlock[] = [];

 function walk(children: Array<Record<string, unknown>> | undefined, underTodo: boolean) {
  if (!children) return;
  for (const child of children) {
   const marker = child.marker as string | undefined;
   const content = String(child.content ?? "");

   if (content.includes("# Todo") && !marker) {
    walk(child.children as Array<Record<string, unknown>> | undefined, true);
    continue;
   }

   if (marker && typeof marker === "string" && marker in VALID_MARKERS) {
    if (!underTodo) {
     orphans.push({
      uuid: String(child.uuid ?? ""),
      content: cleanContent(String(child.content ?? "")),
      marker: marker as TodoBlock["marker"],
      priority: validatePriority(child.priority),
      page: { name: pageName, journalDay: null, journal: false },
     });
    }
   }

   walk(child.children as Array<Record<string, unknown>> | undefined, underTodo);
  }
 }

 walk(blocks as Array<Record<string, unknown>>, false);
 return orphans;
}

/** Move a block to be a child of the # Todo block on a page. */
export async function sweepToTodo(pageName: string, blockUuid: string): Promise<void> {
 const todosUuid = await findOrCreateTodosBlock(pageName);
 await logseq.Editor.moveBlock(blockUuid, todosUuid, { children: true });
}

async function filterUnderTodo(pageName: string | null, tree: TodoBlock[]): Promise<TodoBlock[]> {
 if (!pageName) return tree;
 try {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (!blocks || blocks.length === 0) return tree;

  // Collect all UUIDs that are descendants of # Todo
  const underTodo = new Set<string>();
  function collect(children: Array<Record<string, unknown>> | undefined, collecting: boolean) {
   if (!children) return;
   for (const child of children) {
    const content = String(child.content ?? "");
    const marker = child.marker as string | undefined;
    if (content.includes("# Todo") && !marker) {
     collect(child.children as Array<Record<string, unknown>> | undefined, true);
     continue;
    }
    if (collecting && child.uuid) {
     underTodo.add(String(child.uuid));
    }
    collect(child.children as Array<Record<string, unknown>> | undefined, collecting);
   }
  }
  collect(blocks as Array<Record<string, unknown>>, false);

  // Filter tree to only include nodes under # Todo
  function filterTree(nodes: TodoBlock[]): TodoBlock[] {
   return nodes
    .filter((n) => underTodo.has(n.uuid))
    .map((n) => ({
     ...n,
     children: n.children ? filterTree(n.children) : undefined,
    }));
  }

  return filterTree(tree);
 } catch {
  return tree; // fallback: show everything
 }
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
 // Strip priority tag [#A], [#B], [#C]
 s = s.replace(/^\[#(A|B|C)\]\s*/i, "");
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
   const parsed = parseLogseqDate(stateToday);
   if (parsed) {
    journalDay = parsed;
   } else {
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
 } catch { /* ignore */ }

 return effectiveDay;
}

export async function resolveJournalPageName(day: number): Promise<string | null> {
 const query = `
    [:find (pull ?p [:block/name]) .
     :where
     [?p :block/journal-day ${day}]]
  `;
 const result = await runQuery(query) as { name: string } | null;
 return result?.name ?? null;
}

export async function findOrCreateTodosBlock(pageName: string): Promise<string> {
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
    try { await logseq.Editor.removeBlock(block.uuid); } catch { /* ignore */ }
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

 function walk(children: Array<Record<string, unknown>> | undefined, title: string | null, parentUuid?: string) {
  if (!children) return;
  for (const child of children) {
   const marker = child.marker as string | undefined;
   if (marker && typeof marker === "string" && marker in VALID_MARKERS) {
    const key = title ?? KEY_UNCATEGORIZED;
    const group = groups.get(key);
    const uuid = String(child.uuid ?? "");
    const todo: TodoBlock = {
     uuid,
     content: cleanContent(String(child.content ?? "")),
     marker: marker as TodoBlock["marker"],
     priority: validatePriority(child.priority),
     parentUuid,
     page: { name: pageName, journalDay: null, journal: false },
    };
    if (group) {
     group.push(todo);
    } else {
     groups.set(key, [todo]);
    }
    walk(child.children as Array<Record<string, unknown>> | undefined, title, uuid);
   } else {
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

/* ── Time Log ── */

export async function findOrCreateTimeLogBlock(pageName: string): Promise<string> {
 try {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  for (const block of blocks) {
   if (block.content && typeof block.content === "string" && block.content.includes("# Time Log")) {
    return block.uuid;
   }
  }
 } catch (err) {
  console.warn("[time-log] getPageBlocksTree failed, creating new # Time Log:", err);
 }

 const block = await logseq.Editor.insertBlock(pageName, "# Time Log", {
  isPageBlock: true,
  sibling: true,
  properties: {},
 });
 return block?.uuid ?? "";
}

export function snapTo5(minutes: number): number { return Math.round(minutes / 5) * 5; }

const TIME_RE = /^\((\d{1,2}):(\d{2})\)\s*-\s*\((\d{1,2}):(\d{2})\)\s+(.+)$/;
const START_SCHED_RE = /^\((\d{1,2}):(\d{2})\)\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/;
const END_SCHED_RE = /^(\d{1,2}):(\d{2})\s*-\s*\((\d{1,2}):(\d{2})\)\s+(.+)$/;
const PLAIN_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/;
const OPEN_END_RE = /^(\d{1,2}):(\d{2})\s*-\s+(.+)$/;

export function parseTimeLogEntry(raw: string, blockUuid: string, isClockEntry: boolean): TimeLogEntry | null {
 let m: RegExpMatchArray | null;
 let isScheduledStart = false, isScheduledEnd = false;
 let startMinutes: number, endMinutes: number | null = null;
 let rest: string;
 // Match: (both), (start)-end, start-(end), plain, open-ended
 if ((m = raw.match(TIME_RE))) { startMinutes = +m[1] * 60 + +m[2]; endMinutes = +m[3] * 60 + +m[4]; rest = m[5].trim(); isScheduledStart = isScheduledEnd = true; }
 else if ((m = raw.match(START_SCHED_RE))) { startMinutes = +m[1] * 60 + +m[2]; endMinutes = +m[3] * 60 + +m[4]; rest = m[5].trim(); isScheduledStart = true; }
 else if ((m = raw.match(END_SCHED_RE))) { startMinutes = +m[1] * 60 + +m[2]; endMinutes = +m[3] * 60 + +m[4]; rest = m[5].trim(); isScheduledEnd = true; }
 else if ((m = raw.match(PLAIN_RE))) { startMinutes = +m[1] * 60 + +m[2]; endMinutes = +m[3] * 60 + +m[4]; rest = m[5].trim(); }
 else if ((m = raw.match(OPEN_END_RE))) { startMinutes = +m[1] * 60 + +m[2]; endMinutes = null; rest = m[3].trim(); }
 else return null;
 // Extract ((uuid)) ref first (may be before error suffix)
 let todoUuid: string | undefined;
 const refMatch = rest.match(/\(\(([a-f0-9-]+)\)\)/);
 if (refMatch) { todoUuid = refMatch[1]; rest = rest.replace(/\(\([a-f0-9-]+\)\)/, "").trim(); }
 // Error suffix: (+5) or (-3) — may appear after time, before or after ref
 let errorMinutes: number | undefined;
 const errMatch = rest.match(/\(([+-]?\d+)\)/);
 if (errMatch) { errorMinutes = parseInt(errMatch[1]); rest = rest.replace(/\([+-]?\d+\)/, "").trim(); }
 return { uuid: blockUuid, startMinutes, endMinutes, activity: rest, todoUuid, isClockEntry, isScheduled: isScheduledStart || isScheduledEnd, isScheduledStart, isScheduledEnd, errorMinutes };
}

export function formatTimeLogEntry(entry: TimeLogEntry): string {
 const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
 const s = entry.isScheduledStart ? `(${fmt(entry.startMinutes)})` : fmt(entry.startMinutes);
 const timePart = entry.endMinutes !== null
  ? `${s} - ${entry.isScheduledEnd ? `(${fmt(entry.endMinutes)})` : fmt(entry.endMinutes)}${entry.errorMinutes !== undefined ? ` (${entry.errorMinutes > 0 ? "+" : ""}${entry.errorMinutes})` : ""}`
  : `${s} - ${entry.errorMinutes !== undefined ? ` (${entry.errorMinutes > 0 ? "+" : ""}${entry.errorMinutes})` : ""}`;
 let sfx = "";
 if (entry.todoUuid) sfx += ` ((${entry.todoUuid}))`;
 if (!entry.todoUuid && entry.activity) sfx += ` ${entry.activity}`;
 return (timePart + sfx).trim();
}

export async function sortTimeLogChildren(timeLogUuid: string, entries: TimeLogEntry[]): Promise<void> {
 if (entries.length < 2) return;
 const sorted = [...entries].sort((a, b) => a.startMinutes - b.startMinutes);
 // Check if already sorted
 let needsSort = false;
 for (let i = 0; i < entries.length; i++) {
  if (entries[i].uuid !== sorted[i].uuid) { needsSort = true; break; }
 }
 if (!needsSort) return;
 // Move each block after the previous one in sorted order
 for (let i = 1; i < sorted.length; i++) {
  try {
   await logseq.Editor.moveBlock(sorted[i].uuid, sorted[i - 1].uuid, { before: false, children: false });
  } catch { /* best effort */ }
 }
}

export async function detectAndMerge(timeLogUuid: string): Promise<void> {
 // placeholder — implemented later
}

export async function queryTimeLogEntries(journalDay: number): Promise<TimeLogEntry[]> {
 let pageName = await resolveJournalPageName(journalDay);
 if (!pageName) {
  pageName = String(journalDay);
  await logseq.Editor.createPage(pageName, {}, { journal: true, createFirstBlock: false });
 }
 const timeLogUuid = await findOrCreateTimeLogBlock(pageName);
 if (!timeLogUuid) return [];

 const entries: TimeLogEntry[] = [];

 // Manual entries from # Time Log children
 try {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  const timeLogBlock = (blocks as Array<Record<string, unknown>>).find((b) => b.uuid === timeLogUuid);
  if (timeLogBlock && timeLogBlock.children) {
   const children = timeLogBlock.children as Array<Record<string, unknown>>;
   for (const child of children) {
    const entry = parseTimeLogEntry(String(child.content), String(child.uuid), false);
    if (entry) entries.push(entry);
   }
  }
 } catch (err) {
  console.warn("[time-log] Failed to parse time log entries:", err);
 }

 // CLOCK entries from TODOs on the day
 try {
  // Query all TODOs on the day (not just # Todo descendants)
  const allTodosQuery = `
      [:find (pull ?b [
        :block/uuid
        :block/content
        {:block/page [:block/name :block/journal-day]}
        {:block/parent [:block/uuid]}
      ])
       :where
       [?b :block/page ?p]
       [?p :block/journal-day ${journalDay}]
       ${markerClause()}]`;
  const allResults = await runQuery(allTodosQuery) as Array<Array<unknown>> | null;
  const todos = allResults ? allResults.flat().map(normalizeTodo) : [];
  // Also include reference blocks
  const refTodos = await queryAndResolveRefs(journalDay);
  for (const rt of refTodos) {
   if (!todos.some(t => t.uuid === rt.uuid)) todos.push(rt);
  }
  const existingRefs = new Set(entries.map(e => e.todoUuid).filter(Boolean));
  for (const todo of todos) {
   // For reference blocks, use the original UUID for CLOCK data
   let clockSourceUuid = todo.uuid;
   const refCheck = await logseq.Editor.getBlock(todo.uuid);
   const refContent = typeof refCheck?.content === "string" ? refCheck.content : "";
   const refMatch = refContent.match(/\(\(([a-f0-9-]+)\)\)/);
   if (refMatch) clockSourceUuid = refMatch[1];
   const rawBlock = await logseq.Editor.getBlock(clockSourceUuid);
   const rawContent = typeof rawBlock?.content === "string" ? rawBlock.content : "";
   const clockRanges = parseClockRanges(rawContent, journalDay);
   for (const cr of clockRanges) {
    // Check if a manual entry already exists for this todo at this time
    const alreadyExists = entries.some(e =>
     (e.todoUuid === clockSourceUuid || e.todoUuid === todo.uuid) && e.startMinutes === cr.startMinutes
    );
    if (!alreadyExists) {
     // Auto-materialize: create a # Time Log child for this CLOCK entry
     const activity = cleanContent(todo.content) ?? "";
     await logseq.Editor.insertBlock(
      timeLogUuid,
      `${formatHM(cr.startMinutes)} - ${formatHM(cr.endMinutes)} ((${clockSourceUuid}))`,
      { sibling: false }
     );
    }
   }
  }
 } catch (err) {
  console.warn("[time-log] Failed to parse CLOCK entries:", err);
 }

 // Re-read children to include newly materialized entries
 try {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  const timeLogBlock = (blocks as Array<Record<string, unknown>>).find((b) => b.uuid === timeLogUuid);
  if (timeLogBlock && timeLogBlock.children) {
   const allChildren = timeLogBlock.children as Array<Record<string, unknown>>;
   const freshEntries: TimeLogEntry[] = [];
   for (const child of allChildren) {
    const entry = parseTimeLogEntry(String(child.content), String(child.uuid), false);
    if (entry) freshEntries.push(entry);
   }
   entries.length = 0;
   entries.push(...freshEntries);
  }
 } catch { /* keep existing */ }

 // Post-process: resolve activity for task-linked entries with empty text
 // Sync: ensure all task-linked entries have matching CLOCK data
 for (const entry of entries) {
  if (!entry.todoUuid || entry.endMinutes === null || entry.isScheduled) continue;
  try {
   const block = await logseq.Editor.getBlock(entry.todoUuid);
   if (!block?.content) continue;
   const rawContent = String(block.content);
   const clockRanges = parseClockRanges(rawContent, journalDay);
   const hasMatchingClock = clockRanges.some(cr =>
    cr.startMinutes === entry.startMinutes && cr.endMinutes === entry.endMinutes
   );
   if (!hasMatchingClock) {
    // Add CLOCK entry to LOGBOOK
    const y = Math.floor(journalDay / 10000);
    const m = Math.floor((journalDay % 10000) / 100);
    const d = journalDay % 100;
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const sh = String(Math.floor(entry.startMinutes / 60)).padStart(2, "0");
    const sm = String(entry.startMinutes % 60).padStart(2, "0");
    const eh = String(Math.floor(entry.endMinutes / 60)).padStart(2, "0");
    const em = String(entry.endMinutes % 60).padStart(2, "0");
    const durH = String(Math.floor((entry.endMinutes - entry.startMinutes) / 60)).padStart(2, "0");
    const durM = String((entry.endMinutes - entry.startMinutes) % 60).padStart(2, "0");
    const newClock = `CLOCK: [${dateStr} ${sh}:${sm}:00]--[${dateStr} ${eh}:${em}:00] =>  ${durH}:${durM}:00`;
    const lbMatch = rawContent.match(/:LOGBOOK:([\s\S]*?):END:/i);
    let newContent: string;
    if (lbMatch) {
     newContent = rawContent.replace(/:LOGBOOK:([\s\S]*?):END:/i, `:LOGBOOK:$1${newClock}\n:END:`);
    } else {
     newContent = rawContent + `\n:LOGBOOK:\n${newClock}\n:END:`;
    }
    await logseq.Editor.updateBlock(entry.todoUuid, newContent);
   }
  } catch { /* skip */ }
 }

 // Cleanup: remove CLOCK entries for scheduled blocks (planned !== actual)
 for (const entry of entries) {
  if (!entry.todoUuid || entry.endMinutes === null || !entry.isScheduled) continue;
  try {
   const block = await logseq.Editor.getBlock(entry.todoUuid);
   if (!block?.content) continue;
   const rawContent = String(block.content);
   const y = Math.floor(journalDay / 10000);
   const mo = String(Math.floor((journalDay % 10000) / 100)).padStart(2, "0");
   const d = String(journalDay % 100).padStart(2, "0");
   const sh = String(Math.floor(entry.startMinutes / 60)).padStart(2, "0");
   const sm = String(entry.startMinutes % 60).padStart(2, "0");
   const eh = String(Math.floor(entry.endMinutes / 60)).padStart(2, "0");
   const em = String(entry.endMinutes % 60).padStart(2, "0");
   const datePat = `${y}-${mo}-${d}`;
   const re = new RegExp(`CLOCK:\\s*\\[${datePat}\\s+${sh}:${sm}:\\d{2}\\]--\\[${datePat}\\s+${eh}:${em}:\\d{2}\\].*\\n?`, "gi");
   if (re.test(rawContent)) {
    const cleaned = rawContent.replace(re, "");
    await logseq.Editor.updateBlock(entry.todoUuid, cleaned);
   }
  } catch { /* skip */ }
 }

 // Sort # Time Log children by start time
 await sortTimeLogChildren(timeLogUuid, entries);

 for (const entry of entries) {
  if (!entry.activity.trim() && entry.todoUuid) {
   try {
    const refBlock = await logseq.Editor.getBlock(entry.todoUuid);
    if (refBlock && refBlock.content) {
     entry.activity = cleanContent(String(refBlock.content)) || "(task)";
    } else {
     entry.activity = "(task)";
    }
   } catch {
    entry.activity = "(task)";
   }
  }
 }

 return entries;
}

export function parseClockRanges(raw: string, filterDay?: number): Array<{ startMinutes: number; endMinutes: number }> {
 const logbookMatch = raw.match(/:LOGBOOK:([\s\S]*?):END:/i);
 if (!logbookMatch) return [];
 const ranges: Array<{ startMinutes: number; endMinutes: number }> = [];
 const clockRe = /CLOCK:\s*\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):\d{2}\]--\[.*?(\d{2}):(\d{2}):\d{2}\]/g;
 let cm: RegExpExecArray | null;
 while ((cm = clockRe.exec(logbookMatch[1])) !== null) {
  const clockDate = parseInt(cm[1]) * 10000 + parseInt(cm[2]) * 100 + parseInt(cm[3]);
  if (filterDay !== undefined && clockDate !== filterDay) continue;
  ranges.push({
   startMinutes: parseInt(cm[4]) * 60 + parseInt(cm[5]),
   endMinutes: parseInt(cm[6]) * 60 + parseInt(cm[7]),
  });
 }
 return ranges;
}

function formatHM(minutes: number): string {
 return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export async function updateTimeLogEntry(uuid: string, startMinutes: number, endMinutes: number): Promise<void> {
 const block = await logseq.Editor.getBlock(uuid);
 if (!block) return;
 const entry = parseTimeLogEntry(String(block.content ?? ""), uuid, false);
 if (!entry) return;
 const updated = { ...entry, startMinutes, endMinutes };
 const newContent = formatTimeLogEntry(updated);
 await logseq.Editor.updateBlock(uuid, newContent);
}

export function sortJournalTodos(todos: TodoBlock[]): TodoBlock[] {
 return [...todos].sort((a, b) => (b.page.journalDay ?? 0) - (a.page.journalDay ?? 0));
}

export function sortPageTodos(todos: TodoBlock[]): TodoBlock[] {
 return [...todos].sort((a, b) => a.page.name.localeCompare(b.page.name));
}
