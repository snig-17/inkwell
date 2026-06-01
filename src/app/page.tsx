"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Moon, Plus, Sparkles, Sun, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageView } from "@/components/PageView";
import { RequestBox } from "@/components/RequestBox";
import {
  createPage,
  deletePage,
  listPages,
  restoreBackup,
  snapshotBackup,
  updatePageHtml,
  type Page,
} from "@/lib/db";

// Ask Claude (via the server-side proxy) for a page. `currentHtml` is sent when
// re-prompting an existing page so the model modifies it in place.
async function generate(
  request: string,
  currentHtml?: string,
): Promise<{ html: string; title: string }> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, currentHtml }),
  });
  // Parse defensively: an infra/framework error may return HTML, not our JSON.
  let json: { html?: string; title?: string; error?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      res.ok ? "Malformed response from server." : `Server error (${res.status}).`,
    );
  }
  if (!res.ok || !json?.html) {
    throw new Error(json?.error || `Generation failed (${res.status}).`);
  }
  return { html: json.html, title: json.title ?? "Untitled page" };
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("inkwell-theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("inkwell-theme", next ? "dark" : "light");
  };
  return (
    <Button size="icon-sm" variant="ghost" onClick={toggle} title="Toggle theme">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export default function Home() {
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoableId, setUndoableId] = useState<string | null>(null);

  // PageView registers its data-flush here so we can persist pending writes
  // before snapshotting/regenerating.
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  // IndexedDB is browser-only — load after mount.
  useEffect(() => {
    listPages()
      .then(setPages)
      .catch(() => setError("Could not open the notebook."));
  }, []);

  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const folio = selected
    ? String(pages.findIndex((p) => p.id === selected.id) + 1).padStart(2, "0")
    : null;

  async function handleNew(request: string) {
    setBusy(true);
    setError(null);
    try {
      const { html, title } = await generate(request);
      const page = await createPage({ title, html });
      setPages((prev) => [...prev, page]);
      setSelectedId(page.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReprompt(request: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await flushRef.current?.(); // 1. persist pending data writes
      await snapshotBackup(selected.id); // 2. durable .bak before any risk
      const { html, title } = await generate(request, selected.html); // 3.
      // 4. swap layout, keep data. The iframe is shielded while busy, so no
      // edits raced in during step 3 to be lost by this read-modify-write.
      const updated = await updatePageHtml(selected.id, html, title);
      if (updated) {
        setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setUndoableId(updated.id);
      }
    } catch (e) {
      // 5. on failure leave the page untouched; the backup is harmless.
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!selected) return;
    const restored = await restoreBackup(selected.id);
    if (restored) {
      setPages((prev) => prev.map((p) => (p.id === restored.id ? restored : p)));
    }
    setUndoableId(null);
  }

  async function handleDelete(id: string) {
    await deletePage(id);
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (undoableId === id) setUndoableId(null);
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      {/* Titlebar — translucent vibrancy bar */}
      <header className="ink-titlebar relative z-30 flex h-[46px] shrink-0 items-center gap-3.5 border-b border-border px-3.5">
        <div className="ink-traffic flex items-center gap-2 pr-1">
          <i className="r" />
          <i className="y" />
          <i className="g" />
        </div>
        <span className="text-[13.5px] font-[590] tracking-tight">inkwell</span>
        <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground">
          <span className="ink-pulse" />
          <span>Gemini</span>
        </div>
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar — pages */}
        <aside className="ink-sidebar flex w-[232px] shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="px-2 text-[11px] font-[650] uppercase tracking-[0.04em] text-muted-foreground/80">
              Pages
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              title="New page"
              disabled={busy}
              onClick={() => setSelectedId(null)}
            >
              <Plus />
            </Button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            {pages.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No pages yet — start with “New page”.
              </p>
            ) : (
              pages.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                    p.id === selectedId
                      ? "bg-sidebar-accent font-[560] text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                  )}
                >
                  <FileText className="size-[15px] shrink-0 opacity-70" />
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => setSelectedId(p.id)}
                    title={p.title}
                  >
                    {p.title}
                  </button>
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete page"
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))
            )}
          </nav>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
            <Sparkles className="size-3.5" />
            Local notebook · {pages.length} page{pages.length === 1 ? "" : "s"}
          </div>
        </aside>

        {/* Canvas — the paper spine floats here */}
        <main className="ink-canvas flex flex-1 justify-center overflow-y-auto p-7">
          {selected ? (
            <div className="ink-spine relative flex h-full max-h-full w-full max-w-[880px] flex-col overflow-hidden">
              <span className="ink-spine-edge" />
              <header className="relative shrink-0 border-b border-border pt-9 pr-8 pb-5 pl-[68px]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="ink-kicker mb-3.5">Page · {folio}</div>
                    <h1 className="ink-title break-words">{selected.title}</h1>
                  </div>
                  {undoableId === selected.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={handleUndo}
                      title="Undo the last change to this page"
                      className="shrink-0"
                    >
                      <Undo2 />
                      Undo
                    </Button>
                  )}
                </div>
              </header>

              <div className="min-h-0 flex-1">
                <PageView page={selected} flushRef={flushRef} busy={busy} />
              </div>

              <div className="shrink-0 border-t border-border px-8 py-4">
                {error && (
                  <p className="mb-2 text-sm text-destructive">{error}</p>
                )}
                <RequestBox
                  placeholder="Ask inkwell to change this page… (e.g. “Add a column for funding offered.”)"
                  submitLabel="Update page"
                  pending={busy}
                  onSubmit={handleReprompt}
                />
              </div>
            </div>
          ) : (
            <div className="ink-spine relative flex h-full w-full max-w-[760px] flex-col justify-center overflow-hidden px-[68px] py-12">
              <span className="ink-spine-edge" />
              <div className="ink-kicker mb-4">New page</div>
              <h1 className="ink-title mb-3">Build a page</h1>
              <p className="mb-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Describe the page you need in plain language and inkwell builds it
                — interactive, and saved right here in your notebook.
              </p>
              {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
              <RequestBox
                autoFocus
                placeholder="e.g. “Build me a grad-school application tracker with columns for school, deadline, and status.”"
                submitLabel="Build it"
                pending={busy}
                onSubmit={handleNew}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
