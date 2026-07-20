# Repository Guidelines

## Project Overview

Logseq Time Log is a plugin for [Logseq](https://logseq.com) that provides calendar-based TODO management with drag-and-drop, reference resolution, and interactive marker toggling. It runs inside Logseq's plugin iframe and communicates with the Logseq API via `@logseq/libs`.

## Architecture & Data Flow

```
Logseq (host)
  └─ iframe loads dist/index.html
       └─ main.tsx: imports @logseq/libs → logseq.ready(main) → registers toolbar + renders React
            └─ App.tsx: root state management
                 ├─ CalendarView ←→ DayDetail (journal tab, nested navigation)
                 └─ PageTodos ←→ PageDetail (misc tab, nested navigation)
```

**Key data flow:**

1. `logseq.ready(main)` fires in the iframe — registers toolbar button, calls `showMainUI()`
2. App mounts → `initYears()` queries journal days + page TODOs via Datalog
3. Calendar scrolls years lazily via IntersectionObserver sentinels
4. Day detail queries `queryDayTodos()` which merges marked blocks + resolved references
5. Drag-and-drop from PageTodos → journal: inserts `((uuid))` reference block via `logseq.Editor.insertBlock`
6. Marker changes use `logseq.Editor.updateBlock()` with content prefix rewriting

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
npm run dev          # Vite dev server (not used with Logseq directly)
npx tsc --noEmit    # TypeScript typecheck only
```

**Build output:** `dist/` contains `index.html`, `index-*.js`, `index-*.css`, `package.json`, `icon.png`. Copy this folder to `~/.logseq/plugins/logseq-time-log/`.

## Code Conventions

### TypeScript
- Strict mode enabled. No `any` — use `unknown` + type guards.
- Types in `src/ui/types.ts`: `TodoBlock`, `TodoMarker`, `TodoPriority`, `PageRef`, `TabId`, `ViewLayout`
- `@logseq/libs` provides the global `logseq` object type — reference via `/// <reference types="@logseq/libs" />` or `globals.d.ts`

### React
- Functional components with hooks throughout
- State lifted to `App.tsx` — children receive props
- Nested navigation: calendar↔day-detail, page-list↔page-detail via `selectedDay`/`selectedPage` state

### CSS
- Dark theme by default via CSS custom properties on `:root`
- Light theme via `.light` class override
- Accent color: `var(--ls-accent, var(--accent))` — set from Logseq user config at startup, fallback to `#60a5fa`

### Logseq API (`src/ui/logseq.ts`)
- **Datalog queries** use `logseq.DB.datascriptQuery()` with pull patterns using `{:block/page [...]}` map syntax for nested refs
- **Marker queries** use `(or [?b :block/marker "TODO"] ...)` not `contains?`
- **Reference resolution**: `queryAndResolveRefs()` finds `((uuid))` blocks, calls `getBlock()` to check original marker
- **Marker changes**: `setMarkerPrefix()` rewrites content prefix, `updateBlock()` applies the change
- **Auto-nesting**: `autoNestReferences()` walks original parent chains, calls `moveBlock()` to fix journal hierarchy

### Datalog Pull Patterns
```clojure
(pull ?b [:block/uuid :block/content :block/marker :block/priority
          {:block/page [:block/name :block/journal? :block/journal-day]}
          {:block/parent [:block/uuid]}])
```
Nested refs use `{}` map syntax, NOT bare `:attr [...]` vector syntax.

## Important Files

| File | Role |
|---|---|
| `package.json` | `logseq.main` points to `index.html` — the plugin entry |
| `src/ui/main.tsx` | Plugin bootstrap: `logseq.ready(main)`, toolbar registration, React render |
| `src/ui/App.tsx` | Root state: tabs, calendar, navigation, drag-and-drop, delete/marker handlers |
| `src/ui/logseq.ts` | All Logseq API calls: queries, move-to-journal, delete, marker changes, tree building |
| `src/ui/types.ts` | Shared TypeScript types |
| `src/ui/App.css` | All styles — no CSS modules |
| `vite.config.ts` | Vite build config with `base: ""` for relative asset paths |
| `scripts/copy-to-dist.mjs` | Strips devDependencies from package.json, copies to dist/ |

## Key Patterns

### Navigation
- Calendar ↔ DayDetail uses `selectedDay: number | null`
- Page list ↔ PageDetail uses `selectedPage: string | null`
- ESC key: DayDetail → calendar, PageDetail → page list, root → `hideMainUI()`

### Tree Building
`buildBlockTree(flat: TodoBlock[]): TodoBlock[]` reconstructs parent-child hierarchy from `parentUuid` references. Used everywhere after queries. Components render `children` recursively with `depth` prop for indentation.

### Drag-and-Drop
- `TodoCard` sets `draggable`, `onDragStart` writes `{uuid, content}` as JSON to `dataTransfer`
- Drop zones in `App.tsx` parse JSON, call `handleDropOnJournal(uuid)`
- `moveTodoToJournal` creates `((uuid))` reference block on the target journal day
- Logseq auto-syncs the marker between reference and original

### Lazy Year Loading
- `daysByYear: Map<number, Set<number>>` caches per-year journal day data
- CalendarView uses IntersectionObserver on bottom sentinel + scroll detection for top
- `expandUp`/`expandDown` callbacks prepend/append years to the window

## Plugin Package Structure
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
The `logseq.main` field MUST point to `index.html` — Logseq loads this as the plugin entry. There is no separate JS entry point.

## Tooling
- **Runtime**: Node.js (build only — plugin runs in Logseq's embedded browser)
- **Bundler**: Vite 5 with `@vitejs/plugin-react`
- **TypeScript**: 5.3+, strict mode
- **Package manager**: npm
- **Git**: Conventional commits (`feat(scope):`, `fix(scope):`)
