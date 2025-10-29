# Research: N+1 Performance Quick Wins

## Decisions

### D1. Public page rendering eager-loading
- Decision: Eager-load layout, site, translations via `includes` and preload page fragments with ActiveStorage attachments.
- Rationale: Removes common N+1s triggered by layout and fragment access during public render.
- Alternatives considered:
  - Do nothing: retains N+1s and poor defaults.
  - Make opt-in configuration: violates conventions-first; fewer users benefit.

### D2. Admin pages index/tree eager-loading
- Decision: Include `:site` (and existing categories) when building the pages tree/list to prevent N+1s when rendering URLs/hierarchy.
- Rationale: Page URL helpers reference `site`; avoiding N+1s yields snappier admin UX.
- Alternatives considered:
  - Eager-load more associations by default: increases memory/joins without demonstrated need.

### D3. Association hygiene (`inverse_of`)
- Decision: Add `inverse_of` to fragment and translation associations where missing to reduce back-lookups.
- Rationale: Helps AR avoid unnecessary SELECTs when navigating polymorphic associations.
- Alternatives considered:
  - Skip: leaves some avoidable record fetches during render or save flows.

### D4. Cache usage guidance
- Decision: Prefer pre-rendered content for full page bodies where appropriate; avoid polluting persisted cache when dynamic overrides are in play.
- Rationale: Keeps CPU low and cache correct; aligns with existing engine patterns.
- Alternatives considered:
  - Always re-render on each request: higher CPU, less predictable performance.

## Risks & Mitigations
- Risk: Over-eager `includes` may add joins and memory usage.
  - Mitigation: Use `includes` only for directly referenced associations (layout/site/translations) and `preload` for attachments to avoid wide JOINs.
- Risk: ActiveStorage preload path differences.
  - Mitigation: Use supported preload patterns for attachments and blobs; test with fragment attachments.
- Risk: Edge cases with translations or target pages.
  - Mitigation: Add targeted includes only where used in views.

## Validation Plan
- Enable query-warning tooling in development; exercise P1/P2/P3 scenarios.
- Measure query counts for a page with many fragments/attachments; verify stability.
- Smoke-test cache correctness under content updates and 404 fallback.
