# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

inkwell — an AI-built notebook, built as a **web app**. Product/scope docs at repo root:
`PROBLEM.md`, `PRD.md`, `SPEC.md`, `MOSCOW.md`. Those specs were written for a native SwiftUI
macOS/iPad app; that's superseded — we build on the web stack below, mapping native pieces to web
equivalents (WKWebView → sandboxed iframe + postMessage; Keychain/direct API call → key proxied via
a Next.js Route Handler; local files/CloudKit → IndexedDB; EventKit → deferred).

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui
- Page generation uses **Google Gemini** (model `gemini-2.5-flash`) via its OpenAI-compatible
  endpoint with the `openai` SDK — not Anthropic. The key is read server-side from
  `GEMINI_API_KEY` in `.env.local` and proxied through `src/app/api/generate/route.ts`.

## Commands

Standard Next.js scripts (`dev`/`build`/`start`/`lint`). No test runner is set up yet — add one (and
its script) if you write tests.

## Conventions

- Always use the simplest approach that works; don't reach for abstractions, libraries, or config
  until something actually needs them.
- Never put secrets in code — read them from environment variables. `.env` is gitignored.
