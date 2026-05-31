# inkwell — MoSCoW for a buildable, self-usable v1 (2–3 weeks, solo)

Derived from [SPEC.md](./SPEC.md). Governing rule: **the Must list alone is a product I can open
and use every day**, and one person can build it in 2–3 weeks. Everything else is demoted —
including several items SPEC.md treated as v1.

---

## Must — the irreducible usable loop

1. **macOS only, single local notebook.** One window: a list of pages + an open page. Pages stored as **local JSON/files on disk** — no CloudKit, no accounts.
2. **Ask-and-build.** A request box → **direct Claude call with my own API key** (stored in Keychain). This is the product.
3. **Generative interactive page in a sandboxed `WKWebView`.** Claude returns self-contained HTML/JS; rendered locked-down (no file/network) behind a minimal bridge.
4. **State persists across relaunch.** Bridge `getData()/setData()` writing to the page's local JSON store, so a filled-in tracker is still filled in tomorrow. *(Persistence, not full re-binding — see Should.)*
5. **Re-prompt to modify the open page.** "Add a funding column" → regenerate. Mitigation while re-binding isn't built: snapshot the page JSON to `.bak` before overwriting.

> With these five: type "build me a grad-app tracker," use it, close it, come back. Usable for one person.

## Should — first additions once Must works

- **Data/layout split with safe re-binding** so re-prompts don't wipe entered data. *(The #1 thing to fix after Must — demoted only because personal use can tolerate brief re-entry.)*
- **Preview → commit** (vs. writing straight into the notebook).
- **Auto-retry on a failed/broken generation.**
- **Notebook outline in context** — titles + one-line summaries so requests can reference other pages.

## Could — nice, not load-bearing for personal use

- **EventKit one-way write** to Apple Reminders/Calendar.
- **RAG retrieval / on-device embeddings** (a personal notebook is small; current-page + outline suffices for weeks).
- Structured-doc **fallback** rendering, token-usage display, streamed preview, page reordering/summaries.

## Won't (this v1) — and why

| Cut (SPEC called it v1) | Why it's gone now |
|---|---|
| **iPad/iOS client** | Doubles UI/testing surface. A Mac-only app is usable daily; ship one platform. |
| **CloudKit sync** | Multi-day rabbit hole (schema, conflicts, entitlements) with no payoff for a single-device user. Local files instead. |
| **EventKit Apple write** | Real value, but a separate permissions/integration mini-project, not part of the core describe→page loop. → Could. |
| **RAG + on-device embeddings** | Solves scale that doesn't exist at 5–20 pages. Premature. → Could. |
| **Structured-doc fallback + auto-retry polish** | Matters for *other* users' first impression; for myself a retry button suffices. → Should/Could. |
| **Handwriting / OCR, GoodNotes / PDF import** | Already out in SPEC; stays out — biggest scope trap. |
| **Multiple notebooks, sharing, backend, managed keys, billing, two-way sync** | None needed to be useful to one person; each is weeks of work. |

---

**Riskiest cut:** demoting the **data/layout split** out of Must — the line between "delightful" and "I lost my tracker." Covered in the Must phase by the `.bak` snapshot-before-overwrite mitigation until real re-binding lands in Should.
