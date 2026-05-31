// Wraps Claude-generated HTML for rendering inside a locked-down sandboxed
// iframe (`sandbox="allow-scripts"`, no `allow-same-origin`).
//
// Two things get injected into the document <head>, before any generated
// script runs:
//
//   1. A CSP <meta> that blocks all network egress. The sandbox attribute alone
//      stops DOM/storage access but NOT `fetch`/`XHR`/`WebSocket`, so without
//      this a generated page could exfiltrate the notebook. `default-src 'none'`
//      denies everything; we re-allow only inline script/style and data: URIs
//      for images/fonts — none of which leave the machine.
//
//   2. The bridge bootstrap that defines `window.inkwell`. The handshake is
//      pull-based: the bridge posts `ready` as soon as it runs, and the parent
//      replies with `init` carrying the saved data. Generated code must read
//      data and render only inside `inkwell.onReady(...)`, which makes timing
//      deterministic regardless of load/parse ordering.

// `default-src 'none'` blocks fetch/XHR/WebSocket/beacon and remote img/font, but
// `form-action` and `base-uri` do NOT fall back to it — without them a generated
// page could exfiltrate via an auto-submitted <form action="https://…"> or a
// rewritten <base>. We pin both to 'none'. (Top-level navigation and popups are
// already blocked by the sandbox having neither allow-top-navigation nor
// allow-popups; a self-frame `location=` GET leak is the one residual vector CSP
// cannot close without removing scripting.)
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

function bootstrap(nonce: string): string {
  // `nonce` is a crypto.randomUUID() (hex + hyphens), safe to inline as a JSON
  // string. Every message in/out carries it so the parent can authenticate
  // messages even though the iframe's origin is the opaque string "null".
  return `<meta http-equiv="Content-Security-Policy" content="${CSP}">
<script>
(function () {
  var NONCE = ${JSON.stringify(nonce)};
  var data = {};
  var ready = false;
  var queue = [];

  function flush() {
    ready = true;
    var cbs = queue;
    queue = [];
    cbs.forEach(function (cb) {
      try { cb(); } catch (e) { console.error(e); }
    });
  }

  window.inkwell = {
    getData: function () {
      // Shallow clone so callers mutate through setData, not the live cache.
      return Object.assign({}, data);
    },
    setData: function (field, value) {
      // Coerce the field id to a string so a numeric/other key persists under
      // the same key the parent stores it as (the parent only accepts string
      // fields); otherwise it would round-trip in-session but vanish on reload.
      field = String(field);
      data[field] = value;
      parent.postMessage({ type: "set", nonce: NONCE, field: field, value: value }, "*");
    },
    onReady: function (cb) {
      if (typeof cb !== "function") return;
      if (ready) setTimeout(cb, 0);
      else queue.push(cb);
    },
  };

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.nonce !== NONCE || msg.type !== "init") return;
    data = msg.data || {};
    flush();
  });

  // Pull-based handshake: announce readiness, parent responds with init data.
  parent.postMessage({ type: "ready", nonce: NONCE }, "*");
})();
</script>`;
}

// Produce the full document string for the iframe's `srcdoc`. Claude is asked to
// return a complete <!doctype html> document, so we inject our bootstrap right
// after its opening <head>. Fallbacks cover a missing <head>/<html>.
//
// We locate the tag on a copy with HTML comments blanked out (preserving
// offsets), so a `<head>`/`<html>` token sitting inside a comment — e.g. a page
// that documents HTML — doesn't divert the injection to a spot where the bridge
// would never execute.
export function wrapHtml(html: string, nonce: string): string {
  const inject = bootstrap(nonce);
  const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

  const head = /<head[^>]*>/i.exec(masked);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + "\n" + inject + html.slice(at);
  }

  const htmlTag = /<html[^>]*>/i.exec(masked);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + "\n<head>" + inject + "</head>" + html.slice(at);
  }

  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}
