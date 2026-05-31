# inkwell — V1 Spec

An AI-built notebook for university work. You describe the page you need in plain language
("make me a grad-school application tracker"), and Claude builds a real, interactive page
into your notebook — while keeping awareness of the whole notebook as context. See
[PROBLEM.md](./PROBLEM.md) for the problem statement and JTBD.

This spec covers **V1 only**. Anything not listed under "In Scope" is out of scope.

---

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Platform | Native **macOS + iPadOS/iOS**, SwiftUI, shared codebase |
| Page model | **Generative interactive UI** — Claude generates live code per page |
| Sandbox | Generated pages are **HTML/JS rendered in a locked-down `WKWebView`** with a narrow message bridge |
| Context | **Open page in full + on-demand retrieval of other pages + always-present notebook outline** |
| Beachhead | **Ask-and-build any page** — the generative engine itself is the V1 product |
| Storage / sync | **iCloud / CloudKit**, offline-first |
| Claude API | **User brings own Anthropic API key**; calls go direct from the app |
| Editing | **Data/layout split** — Claude owns layout+code, user data stored separately and survives regeneration |
| Apple integration | **One-way write into Apple Reminders/Calendar** via EventKit |
| Handwriting | **Out of scope for V1** (headline v2 feature) |
| Generation UX | **Preview → commit** |
| Failure handling | **Auto-retry, then fall back to a plain structured-doc version** |

---

## 2. Core concepts

- **Notebook** — the user's single collection of pages, synced via CloudKit. One notebook per user in V1.
- **Page** — a unit of the notebook. Two parts, stored separately (the "data/layout split"):
  - **Layout** — the AI-generated HTML/JS that renders and runs the page (Claude-owned).
  - **Data** — the user-entered state (tracker rows, toggles, notes), stored as structured records keyed to fields the layout declares (user-owned). Survives regeneration.
- **Page spec** — the structured record Claude returns when building a page: page title, declared data fields (id, type, label), the HTML/JS layout, and a one-line summary used for the notebook outline.
- **Notebook outline** — a cheap, always-in-context list of every page's title + one-line summary, giving Claude global awareness without shipping every page's contents.

---

## 3. Architecture

### 3.1 Generation pipeline (the heart of V1)

1. **Request.** User types a request in natural language (e.g. from a "＋ New page" prompt box or an inline "ask inkwell" field).
2. **Context assembly.** The app builds the Claude prompt from: the system prompt + page-spec contract, the **notebook outline** (all titles + summaries), the **currently open page** in full (layout + data), and any **retrieved** pages relevant to the request (see 3.3).
3. **Generate.** Call Claude (user's key) with instructions to return a **page spec**: declared data fields + self-contained HTML/JS layout that reads/writes data only through the bridge API (see 3.2).
4. **Preview.** Render the generated page in a sandboxed preview pane (streamed as it arrives). User can **accept**, **tweak** (re-prompt), or **discard**. Nothing touches the notebook until accept.
5. **Commit.** On accept, persist the page spec (layout) and initialize empty data records in CloudKit. Page appears in the notebook and syncs.
6. **Failure path.** If generation errors or the previewed page fails to render/validate, **auto-retry once or twice** (with the error fed back to Claude). If still broken, **fall back** to a plain structured-doc rendering of the request (headings/text/table/checklist) so the user always gets *something* usable, with a note that the rich version failed.

### 3.2 Sandbox & bridge

- Generated layouts run as **HTML/JS inside `WKWebView`** with: no direct file access, no arbitrary network, JavaScript bridge only.
- A **narrow, audited bridge API** is the *only* way generated code touches the outside world:
  - `inkwell.getData()` / `inkwell.setData(field, value)` — read/write the page's declared data fields (persisted to CloudKit by the native shell).
  - `inkwell.requestCalendarWrite(items)` — request that the native app write reminders/events (see 3.5); always mediated by native UI/permission, never silent.
- Generated code that calls anything outside the bridge simply has no effect (no capability). This is what makes "Claude writes live code" safe enough for V1.

### 3.3 Context strategy

- **Always in context:** the notebook outline (title + one-line summary per page) and the open page in full. This makes inkwell *feel* like it sees everything for minimal tokens.
- **Retrieved on demand:** other pages, via similarity search over **on-device embeddings** (Apple `NLEmbedding`/Core ML) — chosen so retrieval needs **no server and no second API key**, consistent with BYO-key + no-backend. Embeddings are computed on-device when a page is committed/edited and stored in CloudKit.
- Rationale: a degree-long notebook will exceed any full-context window and run up the user's bill; current-page + outline + retrieval scales while preserving the "always sees it" feeling.

### 3.4 Storage & sync (CloudKit)

- **Record types:** `Notebook`, `Page` (title, summary, layout HTML/JS, declared field schema, embedding vector, order), `PageData` (pageRef, field id, value).
- Offline-first; CloudKit handles Mac↔iPad sync. Last-writer-wins at the field/record level for V1 (no custom merge UI).
- Layout and data are separate records so regenerating layout never rewrites data.

### 3.5 Apple integration (one-way write)

- Via **EventKit**, with explicit user permission prompts.
- Generated pages can surface dated items (deadlines, tasks). When the user taps an "add to Reminders/Calendar" affordance, the page calls `inkwell.requestCalendarWrite(...)`; the **native app** performs the write into Apple Reminders/Calendar.
- **One-way only** in V1: inkwell writes out; it does not read back or sync changes from Apple. (Avoids the conflict-resolution time-sink.)

### 3.6 API key

- User pastes their **Anthropic API key** in settings; stored in the **Keychain**. Calls go **directly** from the app to the Anthropic API — no backend, no proxy, no inkwell-side cost.
- Surface estimated/used token info so the user understands they're spending their own quota.

---

## 4. UI/UX (V1)

- **Notebook view:** list/grid of pages (title + summary), reorderable. "＋ New page" opens the request box.
- **Page view:** the rendered sandboxed page, full-bleed, native chrome around it. An "ask inkwell" affordance to re-prompt/modify the current page.
- **Generation preview:** streamed preview with Accept / Re-prompt / Discard.
- **Settings:** API key entry, Calendar/Reminders permission, account/iCloud status.
- Design bar: **no setup, no learning curve** — the only thing a new user must learn is "type what you want." No template gallery, no block menus.

---

## 5. Edge cases & concerns

- **Broken/looping generated JS** → sandbox isolates it; render watchdog + the auto-retry-then-fallback path prevents a dead page.
- **Regeneration vs. data:** if a re-prompt removes a field that holds data, keep the orphaned data records (hidden) rather than deleting, so an accidental drop is recoverable.
- **Cost surprise (BYO key):** show token usage; warn before unusually large generations.
- **No API key / invalid key:** app is usable for viewing existing pages; generation is gated with a clear prompt to add a key.
- **CloudKit conflict:** last-writer-wins per field in V1; acceptable because data is mostly single-user, single-device-at-a-time.
- **Privacy:** notebook content is sent to Anthropic under the *user's own* account/key; state this plainly in onboarding.
- **Offline generation:** generation requires network (Claude); previously committed pages and their data work fully offline.

---

## 6. Explicitly OUT of scope for V1

- Handwriting / Apple Pencil inking and handwriting OCR.
- Importing existing GoodNotes/PDF/image pages.
- Reading **from** Apple Reminders/Calendar or two-way sync.
- Multiple notebooks, sharing, collaboration, multi-user.
- A hosted backend, inkwell-managed API keys, billing, or accounts beyond iCloud.
- Web or Android clients.
- On-device/local LLM generation.
- Template gallery or manual block-based editing.
- Full native (Swift) code-generation for pages; constrained-DSL rendering.
- Custom merge/conflict-resolution UI.

---

## 7. End-to-end test (proves the app works)

A single scripted run that exercises every load-bearing decision. inkwell V1 is "done" when this passes end to end:

**Setup**
1. Fresh install on a Mac signed into iCloud. Launch inkwell, paste a valid Anthropic API key in Settings, grant Calendar/Reminders permission.

**Generate (ask-and-build + preview→commit + sandbox)**
2. Tap "＋ New page" and type: *"Build me a grad-school application tracker with columns for school, deadline, and status, and a button to add each deadline to my calendar."*
3. A page **streams into the preview pane** as an interactive table with an "Add to calendar" control per row. Tap **Accept**.
4. The page appears in the notebook and renders interactively (not a static table).

**Data/layout split + Apple write**
5. Add two schools with deadlines and statuses directly in the page. Tap "Add to calendar" on one row → confirm the native permission/confirmation → verify the event/reminder **appears in Apple Calendar/Reminders**.
6. Force-quit and relaunch → the two rows are **still there** (data persisted).

**Context awareness**
7. Create a second page via: *"Make a page summarizing what other pages I have."* The generated page's content **references the grad-school tracker by name** — proving the notebook outline reached Claude as context.

**Regeneration without data loss (data/layout split)**
8. On the tracker, use "ask inkwell": *"Add a column for funding offered."* The layout regenerates with the new column; the **two schools and their entered data are still present** and correctly placed.

**Sync (CloudKit)**
9. Open inkwell on an iPad signed into the same iCloud account → the tracker and both pages, **including the entered rows**, appear within sync latency.

**Failure handling**
10. Trigger a deliberately impossible/oversized request → after auto-retries, inkwell **falls back to a plain structured-doc** version rather than showing a broken page, with a notice that the rich version failed.

Passing all ten steps demonstrates: native Mac+iPad, generative interactive pages, WebView sandbox + bridge, preview→commit, BYO-key generation, data/layout split with safe regeneration, CloudKit sync, one-way Apple write, whole-notebook context, and graceful failure.
