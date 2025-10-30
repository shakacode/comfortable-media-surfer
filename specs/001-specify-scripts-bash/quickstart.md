# Quickstart: Validate N+1 Performance Quick Wins

## Prerequisites
- Development environment with query-warning tooling enabled (e.g., Bullet)
- Seed site with pages, layouts, fragments, and attachments

## Steps
1. Public render (P1): Request a published page with multiple fragments and attachments.
   - Expectation: No N+1 warnings; stable query count.
2. Admin pages tree (P2): Load admin pages index/tree for a site with many pages.
   - Expectation: No N+1 warnings when rendering URLs and hierarchy.
3. App helpers (P3): Render an app view using common fragment helpers for a single page.
   - Expectation: No N+1 warnings; attachments resolved without per-fragment queries.

## Troubleshooting
- If N+1 warnings persist, capture the stack trace and identify the exact call site; add a targeted `includes`/`preload` to the relevant engine path.
- Verify attachments are preloaded correctly to avoid per-attachment blob queries.
