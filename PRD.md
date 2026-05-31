# inkwell — Product Requirements (Lean, V1)

Sources: [PROBLEM.md](./PROBLEM.md), [SPEC.md](./SPEC.md). This PRD is the *what & why* for V1;
SPEC.md is the *how*.

---

## 1. Problem

University work fractures across incompatible formats (handwritten notes, essays, slides, readings, code) and scattered apps. The tools meant to unify it force a bad trade-off: low-effort apps (Apple Notes/Reminders) can't hold it all, while flexible ones (Notion, Obsidian) demand heavy setup and a steep learning curve. The result is constant tool-switching and manual drudgery — transcribing deadlines into a tracker you never reopen, screenshotting handwritten pages to feed an AI one at a time, rebuilding the same tables by hand. No tool is AI-native by default: none lets you *describe* the page you need and have it built into a notebook the AI already sees in full.

**inkwell** is an AI-built notebook where pages are generated on demand from plain-language requests rather than assembled from templates, with the whole notebook held as context — so the student stops being the builder and the courier between apps.

---

## 2. Target user

**Primary (V1 beachhead):** A university student juggling many courses with mixed note formats, who already lives in the Apple ecosystem (Mac + iPad, Apple Reminders/Calendar) and has rejected Notion/Obsidian as too heavy. Comfortable enough to paste an API key; not a developer. Willing to pay (in their own API spend) for "describe it and it appears."

**Not the V1 user:** teams/collaborators, non-Apple users, and students who want a manual, template-driven workspace.

---

## 3. Goals & non-goals

### Goals
- Let a user create a useful, **interactive** page from a single plain-language request — no templates, no setup.
- Make the notebook feel like the AI **sees everything**, so requests can reference other pages.
- Keep entered data **safe across regenerations** (data/layout split).
- Push deadlines/tasks **into Apple Reminders/Calendar** so the user keeps their existing habit.
- Sync seamlessly across Mac and iPad with **zero backend** to run.
- Near-zero learning curve: the only thing to learn is "type what you want."

### Non-goals (V1)
- Handwriting/Pencil inking and OCR; importing GoodNotes/PDF/image pages.
- Reading *from* Apple Reminders/Calendar or two-way sync.
- Multiple notebooks, sharing, collaboration, multi-user.
- Hosted backend, inkwell-managed keys, billing, web/Android clients.
- Template gallery or manual block-based editing.

---

## 4. Success metrics

**North Star:** **Weekly pages that get used after creation** — pages created via a request that the user *returns to and edits/interacts with on a later day* within 7 days. (Captures the whole loop: the generation was good enough to keep *and* the notebook became a place they come back to — not just a demo toy.)

**Input metrics:**
1. **Generation acceptance rate** — % of generated pages accepted at the preview→commit step (proxy for "the magic works the first time"). Target a healthy majority.
2. **Time-to-first-useful-page** — minutes from first launch (incl. API key + permissions) to a committed, interacted-with page. Lower is the whole value prop.
3. **Regeneration data-loss incidents** — count of re-prompts where user data was lost or misplaced. Target ≈ 0; this is the trust metric.

(Optional watch metric: fallback rate — % of requests that drop to the structured-doc fallback; rising fallback = the engine is failing.)

---

## 5. User stories & acceptance criteria

### US-1 — Ask-and-build a page
*As a student, I want to describe a page in plain language and have inkwell build it, so I don't assemble it myself.*
- **AC1:** A plain-language request produces a generated page streamed into a **preview** before saving.
- **AC2:** User can **Accept**, **Re-prompt**, or **Discard**; nothing enters the notebook until Accept.
- **AC3:** Accepted pages are **interactive** (e.g. a tracker has working controls), not static text.

### US-2 — Notebook-aware requests
*As a student, I want inkwell to know what's already in my notebook, so requests can reference other pages.*
- **AC1:** A request like "summarize my other pages" produces content that **names existing pages**.
- **AC2:** The currently open page is available in full to the model when re-prompting it.

### US-3 — Edit without losing data
*As a student, I want to change a page later without losing what I entered.*
- **AC1:** Re-prompting to add/change a field **regenerates the layout** while preserving existing entered data, correctly re-bound.
- **AC2:** Removing a field hides (does not delete) its data, so an accidental drop is recoverable.

### US-4 — Push deadlines to Apple
*As a student, I want dated items pushed into Apple Reminders/Calendar, so I keep using the apps I already check.*
- **AC1:** A page with dated items offers an add-to-calendar/reminders action.
- **AC2:** Triggering it writes the item into Apple Calendar/Reminders after an explicit permission/confirmation.
- **AC3:** Write is **one-way**; inkwell does not read back or sync changes.

### US-5 — Sync across devices
*As a student, I want my notebook on both Mac and iPad.*
- **AC1:** A page (layout **and** entered data) created on one device appears on the other within sync latency.
- **AC2:** Committed pages and their data are fully usable **offline**; generation requires network.

### US-6 — Bring my own key
*As a student, I want to use my own Anthropic key so there's no signup/billing.*
- **AC1:** Key is entered in settings and stored in the Keychain; generation is gated until a valid key exists.
- **AC2:** Existing pages remain viewable/usable without a key.

### US-7 — Graceful failure
*As a student, I want a usable result even when generation fails.*
- **AC1:** A failed/broken generation auto-retries, then falls back to a plain structured-doc version.
- **AC2:** The fallback is clearly labeled as such; the app never shows a dead/broken page.

---

## 6. Open questions

1. **On-device embedding quality** — Apple `NLEmbedding` keeps RAG backend-free, but is retrieval good enough on a large notebook? Fallback is a backend (which also unlocks hosted keys). *Decide after a retrieval-quality spike.*
2. **"Build anything" reliability** — what request categories does the engine reliably nail vs. fall back on? Need an internal benchmark set of student requests before committing to "any page."
3. **Cost transparency with BYO key** — how do we surface token spend so users aren't surprised, without making it feel like a metered, anxious experience?
4. **Scope of one notebook** — is a single notebook per user enough, or do courses need separation (sections/tags) even in V1?
5. **Preview latency** — is streamed preview fast enough to feel magic, or does perceived wait kill it? Sets a performance budget.
6. **Monetization path** — BYO key means no revenue in V1; what's the intended model later (hosted keys + subscription?) and does it constrain V1 architecture now?
7. **Privacy framing** — sending notebook content to Anthropic under the user's own key is defensible, but how is it communicated at onboarding to keep trust?
