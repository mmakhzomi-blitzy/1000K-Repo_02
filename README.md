# 1000KRepo

## Branch pagination + search (static frontend)

The `public/` directory contains a self-contained static frontend — HTML, CSS
(design tokens + component styles), self-hosted Inter fonts, SVG icons, and a
client-side data model — for the "Branch pagination + search" branch-list UI.
It has zero runtime dependencies and no build step.

### Preview

Serve the `public/` directory over HTTP with any static file server and open the
URL it prints. The interactive behavior is delivered with native ES modules,
which browsers refuse to load over the `file://` protocol, so the page must be
viewed over `http://` rather than by opening `index.html` directly from disk.

A zero-dependency option using the Python that ships with most systems:

```
cd public
python3 -m http.server
```

Then open the printed address (for example `http://localhost:8000/`) in a
browser.

### Notes

- The static foundation (markup, design tokens, component styles, Inter fonts,
  icons, and the branch data model) and the interactive behavior are fully
  implemented. The ES module layer under `public/js/` provides folder
  expand/collapse, branch pagination (infinite scroll), inline search/filter
  with the "Branch not found" empty state, search dismissal, and branch
  selection with the confirmation footer.
- The existing Node.js server (`server.js`) returns a plain-text
  "Hello, World!" response for every request and does not serve these static
  files; wiring it to serve `public/` is intentionally out of scope (a separate
  backend task).
