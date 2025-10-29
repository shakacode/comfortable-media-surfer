# Data Model Overview: N+1 Performance Quick Wins

This feature optimizes read paths without changing persisted schemas.

## Entities Impacted

- Page
  - Associations used during render: `layout`, `site`, `translations`, `fragments`
- Fragment
  - Polymorphic association `record` (Page/Translation); may have attachments
- Attachment (ActiveStorage)
  - Associated to fragments
- Site
  - Referenced for URL generation in admin paths
- Layout
  - Referenced during render

## Relationship Notes
- Ensure `inverse_of` where appropriate (e.g., fragments.record, translations.page) to avoid extra SELECTs.
- Use `includes` for direct associations referenced in controllers/views, and `preload` for nested attachments to avoid large JOINs.

## State/Behavior
- Cache correctness: Use pre-rendered content where appropriate; avoid caching dynamic overrides.
