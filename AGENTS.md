# Repository Guidelines

## Project Overview

Logseq Time Log is a plugin for [Logseq](https://logseq.com) that provides calendar-based TODO management with drag-and-drop, reference resolution, interactive marker toggling, priority-based sorting, time tracking via LOGBOOK parsing, and inline editing. It runs inside Logseq's plugin iframe and communicates with the Logseq API via `@logseq/libs`.

## Architecture & Data Flow

```
Logseq (host)
  └─ iframe loads dist/index.html
       └─ main.tsx: imports @logseq/libs → logseq.ready(main) → registers toolbar + renders React
            └─ App.tsx: root state management (always split view)
                 ├─ Left: CalendarView ←→ DayDetail (journal pane)
                 └─ Right: PageTodos ←→ PageDetail (misc pane)
```

**Key data flow:**

1. `logseq.ready(main)` fires in the iframe — registers toolbar button, calls `showMainUI()`, applies accent color
2. App mounts → `initYears()` queries journal days + page TODOs via Datalog, auto-opens today
3. Calendar scrolls years lazily via IntersectionObserver sentinels
4. Day detail queries `queryDayTodos()` which merges marked blocks + resolved references, filters to `# Todo` descendants
5. Drag-and-drop from PageTodos → journal: inserts `((uuid))` reference block under `# Todo`
6. Marker changes use `logseq.Editor.updateBlock()` with content prefix rewriting
7. Reference resolution: `queryAndResolveRefs()` finds `((uuid))` blocks, calls `getBlock()` to check original marker
8. Auto-nesting: `autoNestReferences()` walks original parent chains, calls `moveBlock()` to fix journal hierarchy
9. Sortable journal TODOs via `@dnd-kit`: reorder calls `moveBlock`, cross-section drops call `updateBlock` for priority

## Key Directories

| Directory | Purpose |
|---|---|
| `src/` | All source code |
| `src/ui/` | React app (components, styles, API wrapper) |
| `src/ui/components/` | React components |
| `scripts/` | Build helper (copies package.json to dist) |
| `dist/` | Build output — **this IS the plugin folder** that goes into Logseq's plugins directory |

## Development Commands

```bash
npm run build        # Full build: vite build + copy-to-dist
npm run lint         # ESLint: react-hooks + typescript-eslint
npm run dev          # Vite dev server (not used with Logseq directly)
npx tsc --noEmit    # TypeScript typecheck only
```

**Build output:** `dist/` contains `index.html`, `index-*.js`, `index-*.css`, `package.json`, `icon.png`. Copy this folder to `~/.logseq/plugins/logseq-time-log/`.

## Code Conventions

### TypeScript
- Strict mode enabled. No `any` — use `unknown` + type guards.
- Types in `src/ui/types.ts`: `TodoBlock`, `TodoMarker`, `TodoPriority`, `PageRef`
- `@logseq/libs` provides the global `logseq` object type — imported as a module, bundled by Vite (not external)

### React
- Functional components with hooks throughout
- State lifted to `App.tsx` — children receive props
- Nested navigation: calendar↔day-detail via `selectedDay`, page-list↔page-detail via `selectedPage`
- Always split view (no tabs): journal on left, misc on right
- `HeaderBar` with refresh + close instead of TabBar

### CSS
- Light theme by default via CSS custom properties on `:root`
- Dark theme via `.dark` class or `body.dark`
- Accent color: `var(--ls-accent, var(--accent))` — set from Logseq user config at startup, fallback to `#60a5fa`

### Logseq API (`src/ui/logseq.ts`)
- **Datalog queries** use `logseq.DB.datascriptQuery()` with pull patterns using `{:block/page [...]}` map syntax
- **Marker queries** use `(or [?b :block/marker "TODO"] ...)` not `contains?`
- **Reference resolution**: `queryAndResolveRefs()` finds `((uuid))` blocks, calls `getBlock()` to check original marker
- **Reference detection for calendar**: queries for `# Todo` blocks + `((` patterns to find journal days with TODOs
- **Marker changes**: `setMarkerPrefix()` rewrites content prefix, `updateBlock()` applies the change
- **Auto-nesting**: `autoNestReferences()` walks original parent chains, calls `moveBlock()` to fix journal hierarchy
- **Priority changes**: rewrites `[#A]` prefix in content via `updateBlock()`
- **Date parsing**: `parseLogseqDate()` handles Logseq date strings like "Jul 20th, 2026" with ordinal suffixes
- **Content cleaning**: `cleanContent()` strips marker prefixes, priority tags, `id::`, and `:LOGBOOK:` drawers

### Datalog Pull Patterns
```clojure
(pull ?b [:block/uuid :block/content :block/marker :block/priority
          {:block/page [:block/name :block/journal? :block/journal-day]}
          {:block/parent [:block/uuid]}])
```
Nested refs use `{}` map syntax, NOT bare `:attr [...]` vector syntax. The `:block/parent` pull enables `buildBlockTree()` to reconstruct hierarchy.

## Important Files

| File | Role |
|---|---|
| `package.json` | `logseq.main` points to `index.html` — the plugin entry |
| `src/ui/main.tsx` | Plugin bootstrap: `logseq.ready(main)`, toolbar registration, React render, accent color |
| `src/ui/App.tsx` | Root state: split view, calendar, navigation, drag-drop, delete/marker/edit/reorder handlers |
| `src/ui/logseq.ts` | All Logseq API calls: queries, move-to-journal, delete, marker/priority changes, tree building, sweep, auto-nesting, content cleaning, date parsing |
| `src/ui/types.ts` | Shared TypeScript types: `TodoBlock`, `TodoMarker`, `TodoPriority`, `PageRef` |
| `src/ui/App.css` | All styles — no CSS modules, single file with CSS custom properties |
| `src/ui/components/CalendarView.tsx` | Scrollable calendar with lazy year expansion |
| `src/ui/components/DayDetail.tsx` | Day view with `@dnd-kit` sortable priority sections, sweep, edit, add-todo |
| `src/ui/components/PageTodos.tsx` | Page card list with search bar |
| `src/ui/components/PageDetail.tsx` | Page detail with title-based TODO grouping |
| `src/ui/components/SearchBar.tsx` | Search bar with 3 modes (active/all TODOs, pages) |
| `src/ui/components/AddTodoBar.tsx` | Quick-add bar with priority selector |
| `src/ui/components/SplitView.tsx` | CSS-based resizable split pane |
| `vite.config.ts` | Vite build config with `base: ""` for relative asset paths |
| `eslint.config.mjs` | ESLint flat config with `react-hooks` and `typescript-eslint` |
| `scripts/copy-to-dist.mjs` | Strips devDependencies from package.json, copies to dist/ |

## Key Patterns

### Navigation
- Calendar ↔ DayDetail uses `selectedDay: number | null`
- Page list ↔ PageDetail uses `selectedPage: string | null`
- ESC key: DayDetail → calendar, PageDetail → page list, root → `hideMainUI()`
- Default: opens today's DayDetail on load

### Tree Building
`buildBlockTree(flat: TodoBlock[]): TodoBlock[]` reconstructs parent-child hierarchy from `parentUuid` references. Used everywhere after queries. Components render `children` recursively with `depth` prop for indentation and `data-depth` CSS attribute.

### Drag-and-Drop (Misc → Journal)
- `TodoCard` sets `draggable`, `onDragStart` writes `{uuid, content}` as JSON to `dataTransfer`
- Drop zones in `App.tsx` parse JSON, call `handleDropOnJournal(uuid)`
- `moveTodoToJournal` creates `((uuid))` reference block under `# Todo` on the target journal day
- Logseq auto-syncs the marker between reference and original

### Sortable Drag-and-Drop (Journal TODOs)
- `@dnd-kit/core` + `@dnd-kit/sortable`: `DndContext` wraps priority sections
- Each section uses `useDroppable({ id: priorityKey })` as a drop target
- Each card uses `useSortable({ id: todo.uuid })` with `PointerSensor` (5px activation distance)
- **Reorder**: drag within same section → `onReorder` → `moveBlock(active, over, { before: false })` → local state swap
- **Priority change**: drag to different section → `onChangePriority` → `updateBlock` with rewritten `[#A]` prefix
- Empty sections appear as drop targets with "Drop here" placeholder during drag
- `DragOverlay` shows dashed-border ghost of dragged item

### Lazy Year Loading
- `daysByYear: Map<number, Set<number>>` caches per-year journal day data
- CalendarView uses scroll detection (top) + IntersectionObserver (bottom) for expansion
- `expandUp`/`expandDown` callbacks prepend/append years to the window
- Days highlighted via `# Todo` block presence + `((` reference patterns

### Content Cleaning
`cleanContent()` in `logseq.ts` applies multiple transforms:
1. Strips `:LOGBOOK:` … `:END:` drawers
2. Strips `property:: value` patterns (like `id:: uuid`)
3. Strips marker prefix (`TODO `, `DOING `, etc.)
4. Strips priority tag (`[#A]`, `[#B]`, `[#C]`)

### LOGBOOK Parsing
`parseLogbookDuration()` extracts `CLOCK: [start]--[end] => HH:MM:SS` entries from raw content, sums durations, returns formatted `HH:MM:SS` string. Displayed as `⏱ HH:MM:SS` badge on todo cards.

### Sweep
`findOrphanTodos(pageName)` finds TODO blocks on a journal page that are NOT descendants of `# Todo`. Sweep button in DayDetail shows popup; clicking an orphan calls `sweepToTodo` → `moveBlock` to nest it under `# Todo`.

### Plugin Package Structure
```json
{
  "logseq": {
    "main": "index.html",
    "id": "logseq-time-log",
    "title": "Time Log",
    "icon": "icon.png"
  }
}
```
The `logseq.main` field MUST point to `index.html` — Logseq loads this as the plugin entry. There is no separate JS entry point. `@logseq/libs` is bundled by Vite (not externalized).

## Tooling
- **Runtime**: Node.js (build only — plugin runs in Logseq's embedded browser)
- **Bundler**: Vite 5 with `@vitejs/plugin-react`
- **TypeScript**: 5.3+, strict mode
- **Linter**: ESLint with `eslint-plugin-react-hooks` + `typescript-eslint`
- **Package manager**: npm
- **Git**: Conventional commits (`feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs:`, `chore:`)
- **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable` for sortable journal TODOs
