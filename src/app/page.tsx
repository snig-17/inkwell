"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
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

export default function Home() {
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The page id with a restorable backup (set after a successful re-prompt), so
  // an "Undo" affordance can roll back a regeneration the user dislikes.
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
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar: the notebook's pages */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold tracking-tight">inkwell</span>
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
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No pages yet.
            </p>
          ) : (
            pages.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  p.id === selectedId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50",
                )}
              >
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
      </aside>

      {/* Main: the open page, or the new-page prompt */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b px-5 py-3">
              <h1 className="flex-1 truncate text-sm font-medium">
                {selected.title}
              </h1>
              {undoableId === selected.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={handleUndo}
                  title="Undo the last change to this page"
                >
                  <Undo2 />
                  Undo change
                </Button>
              )}
            </header>
            <div className="min-h-0 flex-1">
              <PageView page={selected} flushRef={flushRef} busy={busy} />
            </div>
            <div className="border-t px-5 py-3">
              {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
              <RequestBox
                placeholder="Ask inkwell to change this page… (e.g. “Add a column for funding offered.”)"
                submitLabel="Update page"
                pending={busy}
                onSubmit={handleReprompt}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-xl">
              <h1 className="mb-1 text-2xl font-semibold tracking-tight">
                Build a page
              </h1>
              <p className="mb-4 text-sm text-muted-foreground">
                Describe the page you need and inkwell builds it — interactive,
                and saved right here.
              </p>
              {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
              <RequestBox
                autoFocus
                placeholder="e.g. “Build me a grad-school application tracker with columns for school, deadline, and status.”"
                submitLabel="Build it"
                pending={busy}
                onSubmit={handleNew}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
