"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A plain-language prompt box, reused for both creating a new page and
// re-prompting the open one. Submits on click or ⌘/Ctrl+Enter; clears on submit.
export function RequestBox({
  placeholder,
  submitLabel,
  pending,
  onSubmit,
  autoFocus,
  className,
}: {
  placeholder: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (request: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const request = text.trim();
    if (!request || pending) return;
    onSubmit(request);
    setText("");
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <textarea
        value={text}
        autoFocus={autoFocus}
        disabled={pending}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm outline-none transition-colors focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">⌘↵ to send</span>
        <Button onClick={submit} disabled={pending || !text.trim()}>
          {pending ? "Generating…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
