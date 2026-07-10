# 1000KRepo

## Branch pagination + search (static frontend)

A self-contained static frontend (HTML, CSS, and vanilla JavaScript with zero runtime dependencies) implementing the "Branch pagination + search" branch-list UI lives under the `public/` directory. To preview it:

- Open `public/index.html` directly in a web browser, or
- Point any static file server at the `public/` directory.

Note: the existing Node.js server (`server.js`) returns a plain-text "Hello, World!" response for all requests and does not serve these static files; wiring it to serve `public/` is intentionally out of scope (a separate backend task).
