# Time Log Tab — Implementation Plan (Phase 1)

## Overview

Add a second top-level tab "Time Log" to the plugin. The tab shows a split view: journal panel (left, read-only) + time log calendar grid (right). Users drag TODOs from the journal onto time slots, create non-task entries by click-dragging on empty grid space, and move/resize existing time blocks.

## Design Decisions (from grilling session)

|#|Decision|Choice|
|---|---|---|
|1|Tab placement|Merge into HeaderBar: `[Tasks \| Time Log] ...spacer... [↻] [✕]`|
|2|Data model|Children of `# Time Log` block on journal day|
|3|Entry format (task-linked)|`HH:MM - HH:MM ((uuid))` — reference only, content resolved for display|
|4|Entry format (non-task)|`HH:MM - HH:MM description` — free text, no reference|
|5|CLOCK entries|Also `HH:MM - HH:MM ((uuid))`, visually distinct (clock icon, muted), fully draggable/resizable if possible|
|6|Cross-panel DnD|Single unified `DndContext` wrapping the Time Log tab's `SplitView`|
|7|Journal panel in Time Log tab|Read-only: hide edit/delete/sweep/add/reorder. Marker toggles + drag handles only. `readOnly: boolean` prop on DayDetail|
|8|Create-by-drag|Invisible draggable overlay + PointerSensor on grid container. Click-drag empty space → select time range → prompt for name|
|9|Resize blocks|Nested draggable handles at **top** and **bottom** of each block. Top changes startTime, bottom changes endTime|
|10|Block positioning|`position: absolute` within `position: relative` container. `top`/`height` computed from minutes-since-midnight|
|11|Persistence|`logseq.Editor.updateBlock()` rewrites child block content on every drag-end|
|12|Overlap handling|Side-by-side columns (Google Calendar style). Detect overlapping groups, split widths|
|13|Grid visuals|Hour + half-hour + quarter-hour markers on left. Red current-time line. Auto-scroll to current time on open|
|14|Zoom|Ctrl+scroll on grid + `+`/`-` buttons in time log header. Changes px-per-minute ratio|
|15|Day navigation|Calendar on left + `←` `Today` `→` arrows in time log header. Click calendar day syncs both|
|16|`# Time Log` block|`findOrCreateTimeLogBlock()` — same pattern as `findOrCreateTodosBlock()`|
|17|TODO lifecycle|Time log entry stays unchanged when TODO is DONE/deleted. Marker badge updates via reference resolution|
|18|Presets (Phase 2)|Deferred. Stored in localStorage. Vertical split: journal top-left, presets bottom-left, time log right|
|19|Empty day|Empty time grid, ready for use. No special empty state message needed|
|20|DnD overlay|Mini card with computed time: `09:00 - 09:25 Task description`|
|21|CLOCK format|`CLOCK: [date day HH:MM:SS]--[date day HH:MM:SS] => HH:MM:SS`|
|22|Creation modal|Centered overlay: time range + input + Create/Cancel. Enter=confirm, Esc=cancel|
|23|Delete entries|Click=select (highlighted border), ✕ on hover, Delete key removes, Esc deselects|
|24|Block click|Single click selects. Double-click = inline edit activity name. Task-linked: navigate to TODO in Logseq|
|25|Day-switch scroll|Scroll to first entry on new day. If empty, scroll to 06:00|
|26|Block colors|Task=accent, Non-task=amber (#f59e0b), CLOCK=muted+dashed. Three visual categories|
|27|Read-only cards|New `DraggableTodoCard` component (useDraggable, not useSortable). Drag handle (⋮⋮) + marker/checkbox only|
|28|No day selected|Auto-select today when switching to Time Log tab. Both panels show today's data|

## Data Types (new in `types.ts`)

```typescript
// Tab now includes "timelog"
export type TabId = "tasks" | "timelog";
// "journal" → "tasks", "pages" removed as tab concept

// Top-level app tab
export type AppTab = "tasks" | "timelog";

// A parsed time log entry (from child of # Time Log)
export interface TimeLogEntry {
  uuid: string;           // block UUID (child of # Time Log)
  startMinutes: number;   // minutes from midnight (0–1439)
  endMinutes: number;     // minutes from midnight (0–1439)
  activity: string;       // description text (cleaned)
  todoUuid?: string;      // if task-linked, UUID of referenced TODO block
  isClockEntry: boolean;  // true if derived from LOGBOOK CLOCK data
}

// Draggable item types within the unified DndContext
export type DragItemType =
  | "journal-todo"          // TODO card dragged from journal panel
  | "time-block"            // existing time block dragged to move
  | "time-block-top"        // top resize handle
  | "time-block-bottom"     // bottom resize handle
  | "create-selection";     // grid overlay dragged to create new entry

export interface DragData {
  type: DragItemType;
  uuid?: string;            // for journal-todo and time-block
  startMinutes?: number;    // for time-block, top-handle, bottom-handle, create
  endMinutes?: number;      // for time-block, bottom-handle, create
}

// Preset block (Phase 2)
export interface TimePreset {
  id: string;
  label: string;        // display name (e.g., "25m Focus")
  minutes: number;      // duration in minutes, must be multiple of 5
}
```

## Component Tree

```
App.tsx (heavily modified)
├── HeaderBar (modified)
│   ├── Tab buttons: [Tasks] [Time Log]
│   └── Actions: [↻] [✕]
│
├── Tab: "tasks" (current behavior, mostly unchanged)
│   └── SplitView
│       ├── Left: CalendarView | DayDetail (full editing)
│       └── Right: PageTodos | PageDetail
│
└── Tab: "timelog" (NEW)
    └── DndContext (unified, wraps entire SplitView)
        ├── sensors: PointerSensor (activation distance: 5px)
        ├── collisionDetection: pointerWithin (detects when pointer is over the time grid droppable)
        ├── onDragStart → App.handleTimeLogDragStart
        ├── onDragMove → App.handleTimeLogDragMove (snap calculation)
        ├── onDragEnd → App.handleTimeLogDragEnd
        └── SplitView
            ├── Left: CalendarView | DayDetail (readOnly, useDraggable)
            │   └── DayDetail receives readOnly={true}
            │       - Hide: sweep, edit, delete, AddTodoBar
            │       - Replace SortableContext → each card uses useDraggable
            │       - Add drag handle icon (⋮⋮) on each card
            │       - Keep: marker toggles, checkbox toggles
            └── Right: TimeLogView (NEW)
                ├── TimeLogHeader
                │   ├── ← (prev day)
                │   ├── Date display (e.g. "2026-07-20 Monday")
                │   ├── → (next day)
                │   ├── Today button
                │   ├── [−] zoom out
                │   └── [+] zoom in
                ├── TimeGrid (scrollable container)
                │   ├── HourMarkers (left column, sticky)
                │   │   └── Labels at 00:00, 00:15, 00:30, 00:45, 01:00 ... 23:45
                │   ├── CurrentTimeLine (red, absolutely positioned)
                │   ├── TimeBlock[] (absolutely positioned)
                │   │   ├── TopResizeHandle (useDraggable)
                │   │   ├── BlockContent
                │   │   │   ├── Time range label (09:00 - 09:25)
                │   │   │   ├── Activity name or TODO reference display
                │   │   │   └── Clock icon (if CLOCK entry)
                │   │   └── BottomResizeHandle (useDraggable)
                │   └── CreateOverlay (useDraggable, covers full grid, invisible)
                └── DragOverlay (portal)
                    └── Mini card with computed time
```

## File Changes

### New Files

|File|Lines (est.)|Purpose|
|---|---|---|
|`src/ui/components/TimeLogView.tsx`|~80|Container: header + grid + zoom state|
|`src/ui/components/TimeGrid.tsx`|~200|Grid with block positioning, overlap columns, droppable, overlay|
|`src/ui/components/TimeBlock.tsx`|~120|Individual block: positioning, resize handles, display|
|`src/ui/components/HourMarkers.tsx`|~50|Left column with time labels|
|`src/ui/components/CurrentTimeLine.tsx`|~30|Red line at current time|

### Modified Files

|File|Changes|
|---|---|
|`src/ui/types.ts`|Add `AppTab`, `TimeLogEntry`, `DragItemType`, `DragData`, `TimePreset`|
|`src/ui/logseq.ts`|Add `findOrCreateTimeLogBlock()`, `queryTimeLogEntries()`, `parseTimeLogEntry()`, `updateTimeLogEntry()`, `parseClockEntries()`|
|`src/ui/App.tsx`|Add `activeTab` state, Time Log DndContext handlers, `timeLogEntries` state, journal-content branching by tab|
|`src/ui/components/HeaderBar.tsx`|Add tab buttons, accept `activeTab`/`onTabChange` props|
|`src/ui/components/DayDetail.tsx`|Add `readOnly` prop, conditional rendering of interactive elements, drag handles|
|`src/ui/App.css`|Add ~250 lines: time log grid, blocks, markers, header, overlay, zoom|

## Detailed Implementation Steps

### 1. `types.ts` — Update types

```typescript
// Replace:
export type TabId = "journal" | "pages";
// With:
export type AppTab = "tasks" | "timelog";

// Add:
export interface TimeLogEntry { ... }
export type DragItemType = ...;
export interface DragData { ... }
export interface TimePreset { ... }  // Phase 2
```

Keep `ViewLayout` as-is (unused but harmless).

### 2. `logseq.ts` — New helpers

#### `findOrCreateTimeLogBlock(pageName: string): Promise<string>`
- Query page blocks tree via `getPageBlocksTree(pageName)`
- Search for block whose content includes `# Time Log`
- If found, return its UUID
- If not found, `insertBlock(pageName, "# Time Log", { isPageBlock: true, sibling: true })`
- Return the new block UUID

#### `parseTimeLogEntry(raw: string, blockUuid: string, isClockEntry: boolean): TimeLogEntry | null`
- Regex: `/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/`
- Extract start hour/min, end hour/min, activity text
- Check for `((uuid))` in activity — if present, extract `todoUuid`
- Return `TimeLogEntry` or null if format doesn't match

#### `queryTimeLogEntries(journalDay: number): Promise<TimeLogEntry[]>`
1. Find/create `# Time Log` block on the journal day
2. Query child blocks under `# Time Log`:
   ```
   [:find (pull ?b [:block/uuid :block/content])
    :where
    [?b :block/parent ?parent]
    [?parent :block/uuid <todosBlockUuid>]]
   ```
   Note: Datascript doesn't support parameterized UUID in query strings directly. Instead use `getPageBlocksTree` for the `# Time Log` block and iterate children.
3. For each child, call `parseTimeLogEntry()` — collect valid entries
4. Also parse CLOCK entries: query all TODO blocks on the day, extract LOGBOOK CLOCK data via `parseClockEntries()`
5. Merge: manual entries from children + CLOCK entries. CLOCK entries get `isClockEntry: true` and a synthetic UUID for DnD

#### `parseClockEntries(todoBlocks: TodoBlock[]): TimeLogEntry[]`
- For each `TodoBlock` that has a non-null `duration`:
  - We need individual CLOCK start/end times, not just total duration
  - Current `parseLogbookDuration()` returns total, not individual ranges
  - **New function**: `parseClockRanges(raw: string): Array<{startMinutes: number, endMinutes: number}>`
  - Parse format: `CLOCK: [2026-07-20 Mon 21:01:50]--[2026-07-20 Mon 21:01:51] => 00:00:01`
  - Regex: `/CLOCK:\s*\[.*?(\d{2}):(\d{2}):\d{2}\]--\[.*?(\d{2}):(\d{2}):\d{2}\]/g`
  - Extract HH:MM from each bracket (ignore seconds), convert to minutes
  - Accumulate into `Array<{startMinutes, endMinutes}>`
- Map each clock range to a `TimeLogEntry` with `isClockEntry: true`, `todoUuid` set
- Synthetic UUID for DnD: `clock-${todoUuid}-${index}`
- When a CLOCK entry is dragged: create a real child block under `# Time Log`, leave original LOGBOOK untouched

#### `updateTimeLogEntry(uuid: string, startMinutes: number, endMinutes: number, activity?: string): Promise<void>`
- Format: `HH:MM - HH:MM activity` (or `HH:MM - HH:MM ((uuid))` if task-linked)
- Use `logseq.Editor.updateBlock(uuid, formattedContent)`

### 3. `HeaderBar.tsx` — Add tabs

Current props:
```typescript
interface HeaderBarProps {
  onRefresh: () => void;
  onClose: () => void;
}
```

New props:
```typescript
interface HeaderBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onRefresh: () => void;
  onClose: () => void;
}
```

Template change:
```tsx
<header className="header-bar">
  <nav className="header-bar-tabs">
    <button className={`header-bar-tab${activeTab === "tasks" ? " active" : ""}`}
            onClick={() => onTabChange("tasks")}>Tasks</button>
    <button className={`header-bar-tab${activeTab === "timelog" ? " active" : ""}`}
            onClick={() => onTabChange("timelog")}>Time Log</button>
  </nav>
  <span className="header-bar-title">Time Log</span>  {/* or remove entirely */}
  <div className="header-bar-actions">
    <button ...>↻</button>
    <button ...>✕</button>
  </div>
</header>
```

CSS additions:
```css
.header-bar-tabs {
  display: flex;
  gap: 2px;
}
.header-bar-tab {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-family: var(--font);
  cursor: pointer;
  border-radius: var(--radius);
  transition: background 0.15s, color 0.15s;
}
.header-bar-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.header-bar-tab.active {
  background: var(--ls-accent, var(--accent));
  color: #fff;
}
```

### 4. `DayDetail.tsx` — Read-only mode

#### Props
Add `readOnly?: boolean` to `DayDetailProps` (default `false`).

#### Conditional rendering
When `readOnly === true`:
- **Hide**: `AddTodoBar` + sweep button row (entire `.add-todo-row` div)
- **Hide**: inner `DndContext` (so `useDraggable` connects to App's parent DndContext)
- **Replace**: `SortableTodoCard` → `DraggableTodoCard` (new component, defined in DayDetail.tsx)
- **Keep**: marker badge toggle, checkbox toggle

#### New component: `DraggableTodoCard`

```tsx
function DraggableTodoCard({ todo, onChangeMarker, depth = 0 }: {
  todo: TodoBlock;
  onChangeMarker: (uuid: string, marker: TodoBlock["marker"]) => void;
  depth?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.uuid,
    data: { type: "journal-todo" as const, uuid: todo.uuid },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const toggleMarker = todo.marker === "TODO" ? "DOING" : todo.marker === "DOING" ? "TODO" : null;

  return (
    <div ref={setNodeRef} style={style}>
      <div className={`todo-card marker-${todo.marker.toLowerCase()}`}
           style={{ paddingLeft: `${12 + Math.min(depth, 8) * 20}px` }}>
        <span className="todo-drag-handle" {...attributes} {...listeners}>⋮⋮</span>
        <button className={`todo-checkbox${todo.marker === "DONE" ? " checked" : ""}`}
                onClick={(e) => { e.stopPropagation(); onChangeMarker(todo.uuid, todo.marker === "DONE" ? "TODO" : "DONE"); }} />
        {toggleMarker ? (
          <button className="todo-marker todo-marker--clickable"
                  onClick={(e) => { e.stopPropagation(); onChangeMarker(todo.uuid, toggleMarker); }}>
            {MARKER_BADGE[todo.marker]}
          </button>
        ) : (
          <span className="todo-marker">{MARKER_BADGE[todo.marker]}</span>
        )}
        <span className="todo-content">{todo.content}</span>
        {todo.duration && <span className="todo-duration">⏱ {todo.duration}</span>}
      </div>
      {todo.children?.map((child) => (
        <DraggableTodoCard key={child.uuid} todo={child} onChangeMarker={onChangeMarker} depth={depth + 1} />
      ))}
    </div>
  );
}
```

Key differences from `SortableTodoCard`:
- Uses `useDraggable` (not `useSortable`) — connects to parent DndContext in App.tsx
- Drag handle (`⋮⋮`) is the drag activator (spread `{...attributes} {...listeners}` on it)
- No edit button, no delete button
- No inline editing
- Marker toggle and checkbox toggle preserved

**Critical**: When `readOnly`, DayDetail must NOT create its own `DndContext`. The `useDraggable` calls in its children will pick up the parent DndContext from App.tsx.

```tsx
// In DayDetail return:
{readOnly ? (
  // No DndContext — DraggableTodoCard connects to App's context
  <div className="day-detail-sections">
    {orderedKeys.map((key) => (
      <ReadOnlyPrioritySection key={key} label={...} items={...} onChangeMarker={...} />
    ))}
  </div>
) : (
  // Existing DndContext + SortableContext (current behavior)
  <DndContext ...>...</DndContext>
)}
```

`ReadOnlyPrioritySection`: simple section wrapper — no `SortableContext`, no `useDroppable`. Just renders heading + `DraggableTodoCard` list. Cards pick up `useDraggable` context from App.tsx automatically.

### 5. `HourMarkers.tsx` — Time labels

```tsx
interface HourMarkersProps {
  hourHeight: number;  // px per hour (varies with zoom)
}
```

Render a column of time labels. For quarter-hour granularity:
- Full hour labels (00:00, 01:00, ...): bold, full height marker line
- Half-hour labels (00:30, 01:30, ...): medium weight, shorter marker line
- Quarter-hour labels (00:15, 00:45, ...): light, short marker line

Each label positioned absolutely at `top: minutes / 60 * hourHeight`.

```tsx
function HourMarkers({ hourHeight }: HourMarkersProps) {
  const markers: Array<{ minutes: number; label: string; major: boolean; minor: boolean }> = [];
  for (let h = 0; h < 24; h++) {
    markers.push({ minutes: h * 60, label: `${String(h).padStart(2, "0")}:00`, major: true, minor: false });
    markers.push({ minutes: h * 60 + 15, label: "", major: false, minor: true });
    markers.push({ minutes: h * 60 + 30, label: `${String(h).padStart(2, "0")}:30`, major: false, minor: false });
    markers.push({ minutes: h * 60 + 45, label: "", major: false, minor: true });
  }
  // ...
}
```

### 6. `CurrentTimeLine.tsx` — Red line

```tsx
interface CurrentTimeLineProps {
  top: number;  // px from top of grid
}
```

A thin red horizontal line with a small dot/circle on the left. Re-rendered every minute via `setInterval` in the parent.

```tsx
function CurrentTimeLine({ top }: CurrentTimeLineProps) {
  return (
    <div className="time-grid-now" style={{ top: `${top}px` }}>
      <div className="time-grid-now-dot" />
      <div className="time-grid-now-line" />
    </div>
  );
}
```

### 7. `TimeBlock.tsx` — Individual time block

```tsx
interface TimeBlockProps {
  entry: TimeLogEntry;
  style: React.CSSProperties;  // { top, left, width, height } from parent
  isSelected: boolean;
  onSelect: (uuid: string) => void;
  onDoubleClick: (uuid: string) => void;
  onDelete: (uuid: string) => void;
  onMove: (uuid: string, newStart: number, newEnd: number) => void;
  onResizeTop: (uuid: string, newStart: number) => void;
  onResizeBottom: (uuid: string, newEnd: number) => void;
}
```

**Color scheme (CSS classes):**
- `.time-block--task` — accent color background (`var(--ls-accent, #60a5fa)`), white text. For entries with `todoUuid`.
- `.time-block--event` — warm amber background (`#f59e0b`), dark text. For non-task entries (no `todoUuid`, no `isClockEntry`).
- `.time-block--clock` — muted: `color-mix(in srgb, var(--ls-accent) 20%, var(--bg-elevated) 80%)`, dashed border, clock icon (`🕐`). For `isClockEntry === true`.

**Thin block handling (< 15px actual height):**
- When `height < 15`: render as `.time-block--thin` — a 3px colored stripe with a tooltip
- Hide text content, only show the colored left-edge bar
- Resize handles extend 6px beyond visual height (hit area > visual height)
- On hover: show a tooltip/popup with full time range + activity name
- At zoom level 60px/hour: 5min = 5px, 15min = 15px, 25min = 25px. 15px is the threshold where text becomes readable

**Structure:**
```tsx
<div className={`time-block ${colorClass}${isSelected ? " time-block--selected" : ""}${actualHeight < 15 ? " time-block--thin" : ""}`}
     style={style} onClick={() => onSelect(entry.uuid)} onDoubleClick={() => onDoubleClick(entry.uuid)}>
  {/* Top resize handle — separate useDraggable */}
  <div className="time-block-handle time-block-handle--top"
       ref={topHandleRef} {...topHandleListeners} {...topHandleAttributes} />
  
  {/* Body — useDraggable for moving */}
  <div className="time-block-body" ref={bodyRef} {...bodyListeners} {...bodyAttributes}>
    {actualHeight >= 15 && (
      <>
    <span className="time-block-time">{formatTime(entry.startMinutes)} - {formatTime(entry.endMinutes)}</span>
    <span className="time-block-activity">{entry.activity}</span>
    {entry.isClockEntry && <span className="time-block-clock-icon">🕐</span>}
        {entry.todoUuid && !entry.isClockEntry && <span className="time-block-task-icon">📋</span>}
        {!entry.todoUuid && !entry.isClockEntry && <span className="time-block-event-icon">📅</span>}
      </>
    )}
  </div>
  
  {/* Bottom resize handle */}
  <div className="time-block-handle time-block-handle--bottom"
       ref={bottomHandleRef} {...bottomHandleListeners} {...bottomHandleAttributes} />

  {/* Delete button — visible on hover when selected */}
  {isSelected && (
    <button className="time-block-delete" onClick={(e) => { e.stopPropagation(); onDelete(entry.uuid); }}>✕</button>
  )}
</div>
```

**DnD setup:**
- Three `useDraggable` calls (body, top handle, bottom handle)
- Body: `data: { type: "time-block", uuid, startMinutes, endMinutes }`
- Top handle: `data: { type: "time-block-top", uuid, startMinutes, endMinutes }`
- Bottom handle: `data: { type: "time-block-bottom", uuid, startMinutes, endMinutes }`
- Activation constraint: `distance: 3` for body (prevent accidental drags), `distance: 2` for handles
- Body drag `{...attributes} {...listeners}` spread ONLY on the body div — NOT on the whole block (so clicking resize handles doesn't start a move)

**Selection model:**
- Click selects the block (highlighted border: `2px solid var(--text-primary)` via `.time-block--selected`)
- Clicking another block selects that one instead (single selection)
- Clicking empty grid space or pressing Esc deselects
- Delete button (`✕`) appears on hover when selected
- Delete key removes selected block
- Double-click opens inline edit of activity name (replace activity text with an input)

**CLOCK entry lifecycle:**
- CLOCK entries have a synthetic UUID: `clock-${todoUuid}-${index}`
- Rendered in the grid alongside manual entries, but do NOT exist as child blocks under `# Time Log`
- When a CLOCK entry is dragged/resized: create a REAL child block under `# Time Log` with the new time + `((todoUuid))` reference
- The original LOGBOOK data in the TODO block is untouched
- After creation, the entry transitions from `isClockEntry: true` to a regular task-linked entry with a real UUID
- This requires tracking the mapping in state: `Map<syntheticUuid, realUuid>` for subsequent drags in the same session

### 8. `TimeGrid.tsx` — The main grid

```tsx
interface TimeGridProps {
  entries: TimeLogEntry[];
  hourHeight: number;
  onEntryMove: (uuid: string, newStart: number, newEnd: number) => void;
  onEntryResizeTop: (uuid: string, newStart: number) => void;
  onEntryResizeBottom: (uuid: string, newEnd: number) => void;
  onCreateEntry: (startMinutes: number, endMinutes: number) => void;
  onEntryClick: (uuid: string) => void;
}
```

**Layout:**
```tsx
<div className="time-grid" ref={gridRef}>
  <HourMarkers hourHeight={hourHeight} />
  <CurrentTimeLine top={currentTimeTop} />
  
  {/* Droppable zone for journal TODOs */}
  <div className="time-grid-zone" ref={setDroppableRef}>
    {/* Rendered blocks with overlap columns */}
    {layoutBlocks.map((block) => (
      <TimeBlock key={block.entry.uuid} ... />
    ))}
  </div>
  
  {/* Invisible overlay for create-by-drag */}
  <div className="time-grid-create-overlay"
       ref={createOverlayRef} {...createOverlayListeners} {...createOverlayAttributes} />
</div>
```

**Overlap column calculation:**
```
function computeLayout(entries: TimeLogEntry[]): Array<{ entry: TimeLogEntry; column: number; totalColumns: number }>
```
1. Sort entries by start time
2. Group into overlapping sets (entry A overlaps B if A.start < B.end AND B.start < A.end)
3. Within each overlapping group, assign columns greedily (first available)
4. Each block's `left` = `COLUMN_WIDTH + column * (BLOCK_WIDTH / totalColumns)`
5. Each block's `width` = `BLOCK_WIDTH / totalColumns - GAP`
6. Non-overlapping blocks: full width

**Create overlay:**
- `useDraggable` with `data: { type: "create-selection" }`
- `useDroppable` on the grid zone (for receiving journal TODOs)
- Custom `activationConstraint` for the overlay: only activate when clicking empty space (check if click target is the overlay itself, not a TimeBlock)
- During drag: show a blue highlight spanning the dragged time range
- On drag end → `onCreateEntry(startMinutes, endMinutes)` → App shows a prompt modal

### 9. `TimeLogView.tsx` — Container

```tsx
interface TimeLogViewProps {
  journalDay: number;
  entries: TimeLogEntry[];
  loading: boolean;
  onEntryMove: ...;
  onEntryResizeTop: ...;
  onEntryResizeBottom: ...;
  onCreateEntry: ...;
  onEntryClick: ...;
  onDayChange: (day: number) => void;
}
```

**State:**
- `hourHeight: number` — px per hour, default 60, range 30–120
- Zoom: Ctrl+scroll adjusts `hourHeight` by ±10, `+`/`-` buttons by ±15

**Scroll behavior:**
- On mount or day change: scroll to show the first time entry. If no entries, scroll to 06:00
- Independent scroll — the time grid panel scrolls vertically, journal panel scrolls independently
- `overscroll-behavior: contain` to prevent iframe scroll stealing

**Template:**
```tsx
<div className="time-log-view">
  <div className="time-log-header">
    <button onClick={goToPrevDay}>←</button>
    <span className="time-log-date">{formatDay(journalDay)}</span>
    <button onClick={goToNextDay}>→</button>
    <button onClick={goToToday}>Today</button>
    <div className="time-log-zoom">
      <button onClick={zoomOut}>−</button>
      <span>{Math.round(hourHeight / 60 * 100)}%</span>
      <button onClick={zoomIn}>+</button>
    </div>
  </div>
  
  {loading ? <p>Loading...</p> : (
    <TimeGrid
      entries={entries}
      hourHeight={hourHeight}
      onEntryMove={onEntryMove}
      ...
    />
  )}
</div>
```

### 10. `App.tsx` — Integration

#### New state
```typescript
const [activeTab, setActiveTab] = useState<AppTab>("tasks");
const [timeLogEntries, setTimeLogEntries] = useState<TimeLogEntry[]>([]);
const [timeLogLoading, setTimeLogLoading] = useState(false);
const [createModalOpen, setCreateModalOpen] = useState(false);
const [createModalRange, setCreateModalRange] = useState<{start: number, end: number} | null>(null);
const [dragOverMinutes, setDragOverMinutes] = useState<number | null>(null); // for overlay
const [selectedBlockUuid, setSelectedBlockUuid] = useState<string | null>(null);
const [editingBlockUuid, setEditingBlockUuid] = useState<string | null>(null);
const gridRef = useRef<HTMLDivElement>(null);
```

#### Load time log entries
When `selectedDay` changes AND `activeTab === "timelog"`:
```typescript
useEffect(() => {
  if (activeTab === "timelog" && selectedDay !== null) {
    setTimeLogLoading(true);
    queryTimeLogEntries(selectedDay).then(setTimeLogEntries).finally(() => setTimeLogLoading(false));
  }
}, [activeTab, selectedDay]);
```

#### Unified DndContext handlers

**`handleTimeLogDragStart`** (`onDragStart`):
- Set active drag state for overlay rendering
- Track the drag data type

**`handleTimeLogDragMove`** (`onDragMove`):
- For `journal-todo` or `create-selection`: calculate the time position from pointer Y relative to grid
- Snap to 5-min intervals: `Math.round(minutes / 5) * 5`
- Update `dragOverMinutes` for visual feedback

**`handleTimeLogDragEnd`** (`onDragEnd`):
- Switch on `active.data.current.type`:

  **`journal-todo`**: 
  - If dropped on time grid (over droppable):
    - Compute start time from drop position (snapped to 5 min)
    - Compute end time = start + 25 min (default)
    - Call `createTimeLogEntry(uuid, startMinutes, endMinutes)`
  
  **`time-block`**:
  - Compute new start time from drop position
  - Preserve duration: newEnd = newStart + (oldEnd - oldStart)
  - Call `updateTimeLogEntry(uuid, newStart, newEnd)`
  - If CLOCK entry: create new child block, don't modify original
  
  **`time-block-top`**:
  - Compute new start time (end time stays fixed)
  - Clamp: newStart < endTime - 5min minimum
  - Call `updateTimeLogEntry(uuid, newStart, endTime)`
  
  **`time-block-bottom`**:
  - Compute new end time (start time stays fixed)
  - Clamp: newEnd > startTime + 5min minimum
  - Call `updateTimeLogEntry(uuid, startTime, newEnd)`
  
  **`create-selection`**:
  - Compute start/end from drag distance
  - Open creation modal: `setCreateModalRange({start, end})` → `setCreateModalOpen(true)`

#### Persistence helpers

**`createTimeLogEntry(todoUuid: string, startMinutes: number, endMinutes: number)`**:
1. Find/create `# Time Log` block on `selectedDay`
2. Format: `HH:MM - HH:MM ((todoUuid))`
3. `logseq.Editor.insertBlock(timeLogBlockUuid, content, { sibling: false })`
4. Refresh `timeLogEntries`

**`createNonTaskEntry(startMinutes: number, endMinutes: number, activity: string)`**:
1. Find/create `# Time Log` block
2. Format: `HH:MM - HH:MM activity`
3. `logseq.Editor.insertBlock(timeLogBlockUuid, content, { sibling: false })`
4. Refresh `timeLogEntries`

**`handleTimeLogEntryMove(uuid, newStart, newEnd)`**:
1. Get original block content
2. Parse existing `((uuid))` reference or activity text
3. Reconstruct: `HH:MM - HH:MM <rest>`
4. `logseq.Editor.updateBlock(uuid, newContent)`
5. Refresh `timeLogEntries`

#### Render branching
```tsx
const journalContent = selectedDay !== null ? (
  <div className="journal-drop-zone" ...>
    <DayDetail
      readOnly={activeTab === "timelog"}
      ...existing props...
    />
  </div>
) : (
  <div className="journal-drop-zone" ...>
    <CalendarView ... />
  </div>
);

const rightContent = activeTab === "tasks"
  ? (selectedPage !== null
      ? <PageDetail ... />
      : <PageTodos ... />)
  : <TimeLogView
      journalDay={selectedDay ?? today}
      entries={timeLogEntries}
      loading={timeLogLoading}
      onEntryMove={handleTimeLogEntryMove}
      ...
    />;

return (
  <div className="time-log-app">
    <HeaderBar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onRefresh={initYears}
      onClose={handleClose}
    />
    <main className="time-log-content">
      {activeTab === "tasks" ? (
        <SplitView left={journalContent} right={rightContent} />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleTimeLogDragStart}
          onDragMove={handleTimeLogDragMove}
          onDragEnd={handleTimeLogDragEnd}
        >
          <SplitView left={journalContent} right={rightContent} />
          <DragOverlay>
            {/* Mini card with time, rendered during drag */}
          </DragOverlay>
        </DndContext>
      )}
    </main>
    
    {/* Creation modal */}
    {createModalOpen && (
      <div className="time-create-modal-overlay" onClick={() => setCreateModalOpen(false)}>
        <div className="time-create-modal" onClick={(e) => e.stopPropagation()}>
          <h3>New Entry</h3>
          <p className="time-create-modal-range">
            {createModalRange && `${formatTime(createModalRange.start)} - ${formatTime(createModalRange.end)}`}
          </p>
          <input type="text" placeholder="Activity name" autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") { /* create + close */ }
              if (e.key === "Escape") { setCreateModalOpen(false); }
            }} />
          <div className="time-create-modal-actions">
            <button onClick={() => setCreateModalOpen(false)}>Cancel</button>
            <button onClick={() => { /* createNonTaskEntry */ }}>Create</button>
          </div>
        </div>
      </div>
    )}
  </div>
);
```

### 11. `App.css` — New styles

Key new CSS sections:

```css
/* ── Header Bar Tabs ── */
.header-bar-tabs { display: flex; gap: 2px; }
.header-bar-tab { ... }
.header-bar-tab.active { ... }

/* ── Time Log View ── */
.time-log-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.time-log-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg-surface); }
.time-log-date { font-size: 14px; font-weight: 600; color: var(--text-primary); flex: 1; text-align: center; }
.time-log-nav-btn { ... }
.time-log-today-btn { ... }
.time-log-zoom { display: flex; align-items: center; gap: 4px; }
.time-log-zoom-btn { ... }

/* ── Time Grid ── */
.time-grid { display: flex; flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; }
.time-grid-markers { width: 60px; flex-shrink: 0; position: relative; border-right: 1px solid var(--border); }
.time-grid-marker { position: absolute; left: 0; right: 0; display: flex; align-items: center; font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); }
.time-grid-marker--hour { font-weight: 700; font-size: 11px; color: var(--text-secondary); }
.time-grid-marker--half { color: var(--text-muted); }
.time-grid-marker-line { border-top: 1px solid var(--border); }
.time-grid-marker-line--hour { border-top-width: 1px; }
.time-grid-marker-line--half { border-top: 1px dashed var(--border); }
.time-grid-marker-line--quarter { border-top: 1px dotted var(--border); opacity: 0.4; }

/* ── Time Grid Zone (blocks area) ── */
.time-grid-zone { flex: 1; position: relative; min-height: 100%; }

/* ── Current Time Line ── */
.time-grid-now { position: absolute; left: 0; right: 0; height: 2px; background: var(--danger); z-index: 3; pointer-events: none; }
.time-grid-now-dot { position: absolute; left: -4px; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }

/* ── Time Block ── */
.time-block { position: absolute; border-radius: 4px; background: var(--ls-accent, var(--accent)); color: #fff; font-size: 12px; overflow: hidden; cursor: grab; z-index: 1; border: 1px solid rgba(0,0,0,0.1); transition: box-shadow 0.15s; min-height: 20px; }
.time-block:hover { z-index: 2; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.time-block--clock { background: var(--bg-elevated); color: var(--text-primary); border: 1px dashed var(--border); font-style: italic; }
.time-block-body { padding: 2px 6px; display: flex; flex-direction: column; gap: 1px; height: 100%; }
.time-block-time { font-size: 10px; opacity: 0.8; font-family: var(--font-mono); white-space: nowrap; }
.time-block-activity { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-block-clock-icon { font-size: 10px; opacity: 0.6; }

/* ── Resize Handles ── */
.time-block-handle { position: absolute; left: 0; right: 0; height: 6px; cursor: ns-resize; z-index: 3; }
.time-block-handle--top { top: -3px; }
.time-block-handle--bottom { bottom: -3px; }

/* ── Create Overlay ── */
.time-grid-create-overlay { position: absolute; top: 0; left: 60px; right: 0; bottom: 0; z-index: 0; cursor: crosshair; }

/* ── Drag Overlay ── */
.time-drag-overlay { padding: 6px 10px; background: var(--ls-accent, var(--accent)); color: #fff; border-radius: var(--radius); font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); white-space: nowrap; }

/* ── Drag Handle on Journal TODOs ── */
.todo-drag-handle { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--text-muted); font-size: 12px; cursor: grab; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.todo-card:hover .todo-drag-handle { opacity: 1; }

/* ── Creation Modal ── */
.time-create-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; display: flex; align-items: center; justify-content: center; }
.time-create-modal { background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; width: 300px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.time-create-modal h3 { margin-bottom: 8px; font-size: 14px; }
.time-create-modal input { width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-surface); color: var(--text-primary); font-size: 13px; margin-bottom: 10px; }
.time-create-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

## DnD Flow Diagrams

### Drag journal TODO → time log
```
User starts drag on TodoCard (useDraggable, type: "journal-todo")
  → onDragStart: setActiveId, note drag type
  → onDragMove: pointer Y position → calculate time slot, snap to 5min
  → DragOverlay renders: mini card "HH:MM - HH:MM Task Name"
  → User drops on time grid droppable zone
  → onDragEnd:
      1. Calculate startMinutes (snapped) from drop Y
      2. Calculate endMinutes = startMinutes + 25 (default duration)
      3. Find # Time Log block (create if missing)
      4. insertBlock(timeLogUuid, "HH:MM - HH:MM ((todoUuid))")
      5. Refresh timeLogEntries
```

### Drag time block to move
```
User starts drag on TimeBlock body (useDraggable, type: "time-block")
  → onDragStart: note uuid, original start/end
  → onDragMove: calculate delta in minutes, snap, show ghost at new position
  → onDragEnd:
      1. newStart = originalStart + deltaMinutes (snapped)
      2. newEnd = originalEnd + deltaMinutes (snapped)
      3. updateBlock(uuid, "newTime - newTime ((ref))" or "newTime - newTime desc")
      4. Refresh
```

### Drag resize handle
```
User drags bottom handle (useDraggable, type: "time-block-bottom")
  → onDragStart: note uuid, original end
  → onDragMove: newEnd = snap(originalEnd + delta)
  → onDragEnd:
      1. newEnd = snap(pointerPosition)
      2. Clamp: newEnd > startTime + 5
      3. updateBlock(uuid, "startTime - newEnd ...")
      4. Refresh
```

### Click-drag to create non-task entry
```
User mousedown on empty grid space → overlay's useDraggable activates
  → onDragStart: note drag start position → startMinutes (snapped)
  → onDragMove: current position → currentMinutes (snapped), show blue selection ghost
  → onDragEnd:
      1. endMinutes = snap(finalPosition)
      2. Ensure endMinutes > startMinutes + 5, else set to startMinutes + 25
      3. Open creation modal with {startMinutes, endMinutes}
      4. User types activity name, clicks Create
      5. insertBlock(timeLogUuid, "HH:MM - HH:MM activity name")
      6. Refresh
```

## Edge Cases

1. **Midnight crossover**: Blocks extending past 23:59? Not supported in Phase 1. End time clamped to 23:59.
2. **Zero-duration blocks**: Enforce minimum 5-min duration.
3. **CLOCK entry creation**: When a CLOCK entry is dragged, a new child block is created under `# Time Log`. The original LOGBOOK data is untouched. The new block uses the CLOCK's `((uuid))` reference.
4. **Race conditions**: Two rapid drag operations? `updateBlock` is async — use sequential awaits. Debounce refresh (300ms) to avoid query storms.
5. **Deleted # Time Log block**: `findOrCreateTimeLogBlock` handles recreation.
6. **Empty journal day**: Both panels show empty states. Time grid is fully functional for creating entries.
7. **Tab switch mid-drag**: DndContext unmounts when switching tabs — drag is cancelled. @dnd-kit handles this gracefully.
8. **Logseq hides panel during scroll**: `overscroll-behavior: contain` on grid container prevents iframe scroll stealing.
9. **Very tall grid (zoomed in)**: Max `hourHeight` = 120px → 2880px total. Handle with scroll. Min = 30px → 720px total.

## Build & Verification

```bash
npm run build        # tsc --noEmit + vite build + copy-to-dist
npm run lint         # eslint src/
npx tsc --noEmit     # type check standalone
```

## Phase 2 (Future): Presets Stamp System

Deferred features:
- Vertical split in left panel: top (journal TODOs) + bottom (presets)
- Presets stored in localStorage: `[{ id, label, minutes }]`
- Preset config UI (add/remove/edit presets)
- Drag preset block into time log → creates entry with preset duration
- Presets are infinite-use, reset activity name after each stamp
