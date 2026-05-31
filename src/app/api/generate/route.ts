// Server-side proxy to the Gemini API (via its OpenAI-compatible endpoint). The
// user's key lives in .env.local and never reaches the browser (the web mapping
// of the SPEC's Keychain + direct call). Given a plain-language request — and,
// when re-prompting, the page's current HTML — the model returns a single
// self-contained interactive HTML document that persists its state through the
// injected `window.inkwell` bridge.

import OpenAI from "openai";

// gemini-2.5-flash is the fastest, free-tier Flash model on the Gemini Developer
// API (confirmed free of charge for text in/out on ai.google.dev pricing).
const MODEL = "gemini-2.5-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const MAX_TOKENS = 16000;

// The generation contract.
const SYSTEM_PROMPT = `You build a single page for "inkwell", an AI notebook. You are given a plain-language request and must return ONE self-contained, interactive HTML document that renders that page.

OUTPUT
- Output ONLY the HTML document. No markdown, no code fences, no commentary.
- A complete <!doctype html> document with <head> and <body>.
- Include a short, human <title> (used as the page's label in the notebook sidebar).
- All CSS in a <style> tag and all JS in a <script> tag. Vanilla JS only — no build step, no imports, no frameworks.

NO NETWORK / NO EXTERNAL RESOURCES
- You have no network access. Do NOT use <link>, <script src>, remote web fonts, remote images, fetch, XMLHttpRequest, or WebSocket — they are blocked and will fail.
- Inline everything. Images, if any, must be inline SVG or data: URIs.

PERSISTENCE — the only way to save state
- A global "window.inkwell" is injected before your code runs. Do not redefine it.
- inkwell.getData() returns the saved data object for this page (may be {} on first load).
- inkwell.setData(fieldId, value) saves one field. Call it whenever the user changes something. Values must be JSON-serializable (strings, numbers, booleans, arrays, plain objects).
- inkwell.onReady(callback) fires once the saved data is available. READ DATA AND RENDER ONLY INSIDE THIS CALLBACK. Do not read data or build the UI at the top level — saved data is not ready yet.
- Choose stable, descriptive fieldIds. Store ALL user-entered state through setData; never rely on the DOM alone to survive a reload.

BEHAVIOR
- The page must be immediately usable and interactive (working controls, not static text).
- On load, restore prior state from getData() inside onReady().
- Be robust: no infinite loops, no alert/prompt/confirm dialogs, degrade gracefully if a field is missing.`;

const MODIFY_PREFIX = `Modify the existing page below according to this request: `;

const MODIFY_RULES = `

IMPORTANT when modifying: reuse the EXACT same fieldIds for any data that should persist. Do not rename existing fieldIds, or previously entered data will not reappear. Preserve existing functionality unless the request says otherwise. Return the complete updated HTML document.

CURRENT PAGE HTML:
`;

function stripFences(text: string): string {
  // Defensive: the contract forbids fences, but strip them if a model adds them.
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, "&"); // ampersand last so it doesn't double-decode
}

function extractTitle(html: string, fallback: string): string {
  // Non-greedy across newlines, strip any inner markup, then decode entities so
  // "Plan &amp; budget" / a stray '<' don't yield a garbled or truncated label.
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = m?.[1]?.replace(/<[^>]*>/g, "").trim();
  const title = raw ? decodeEntities(raw) : "";
  if (title) return title;
  const f = fallback.trim();
  return f.length > 40 ? f.slice(0, 40).trimEnd() + "…" : f || "Untitled page";
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GEMINI_API_KEY. Add it to .env.local." },
      { status: 500 },
    );
  }

  let body: { request?: unknown; currentHtml?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userRequest = typeof body.request === "string" ? body.request.trim() : "";
  const currentHtml =
    typeof body.currentHtml === "string" ? body.currentHtml : undefined;

  if (!userRequest) {
    return Response.json({ error: "Request text is required." }, { status: 400 });
  }

  const userMessage = currentHtml
    ? MODIFY_PREFIX + userRequest + MODIFY_RULES + currentHtml
    : userRequest;

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";

    const html = stripFences(text);
    // Require an actual document, not just any tag-like token — otherwise a
    // refusal/prose reply ("I can't, but here's an <example>…") would be stored
    // as a page and wrapped into a broken document.
    const looksLikeDocument = /<!doctype html|<html[\s>]|<body[\s>]/i.test(html);
    if (!html || !looksLikeDocument) {
      return Response.json(
        { error: "Generation did not return a usable HTML document." },
        { status: 502 },
      );
    }

    const title = extractTitle(html, userRequest);
    return Response.json({ html, title });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Generation failed: ${detail}` },
      { status: 502 },
    );
  }
}
