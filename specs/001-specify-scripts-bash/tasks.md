---
description: "Task list for N+1 Performance Quick Wins"
---

# Tasks: N+1 Performance Quick Wins

**Input**: Design documents from `/specs/001-specify-scripts-bash/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in spec; omit explicit test tasks. Validation via quickstart steps and local query-warning tooling.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Add Unreleased entry placeholder for N+1 improvements in CHANGELOG.md (/Users/petealbertson/Projects/comfortable-media-surfer/CHANGELOG.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T002 [P] Add `inverse_of: :record` to fragments association in app/models/concerns/comfy/cms/with_fragments.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/concerns/comfy/cms/with_fragments.rb)
- [ ] T003 [P] Add `inverse_of: :translations` to has_many :translations in app/models/comfy/cms/page.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/comfy/cms/page.rb)
- [ ] T004 [P] Add `inverse_of: :page` to belongs_to :page in app/models/comfy/cms/translation.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/comfy/cms/translation.rb)

**Checkpoint**: Association hygiene in place to reduce back-lookups.

---

## Phase 3: User Story 1 - Public page render without N+1 (Priority: P1) 🎯 MVP

**Goal**: Public CMS page requests avoid N+1 queries by default with safe eager-loading; render remains correct.

**Independent Test**: Request a published page with multiple fragments and attachments; expect zero N+1 warnings and stable query count.

### Implementation for User Story 1

- [ ] T005 [US1] Update page lookup in app/controllers/comfy/cms/content_controller.rb to eager-load `:layout, :translations, :site` and preload `fragments` attachments (ActiveStorage blobs) (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/cms/content_controller.rb)
- [ ] T006 [P] [US1] Refactor content_controller to centralize the page base scope (with includes/preload) used by both normal and 404 fallback paths (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/cms/content_controller.rb)
- [ ] T007 [P] [US1] Add inline documentation comment in content_controller.rb explaining eager-loading and cache correctness rationale per Constitution (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/cms/content_controller.rb)

**Checkpoint**: Public render path free of N+1 warnings; behavior unchanged.

---

## Phase 4: User Story 2 - Admin pages tree without N+1 (Priority: P2)

**Goal**: Admin pages index/tree renders without N+1 queries when building URLs and hierarchy.

**Independent Test**: Load admin pages index/tree for a site with many pages; expect zero N+1 warnings.

### Implementation for User Story 2

- [ ] T008 [US2] Include `:site` in `pages_grouped_by_parent` scope to avoid URL-related N+1s in app/controllers/comfy/admin/cms/pages_controller.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/admin/cms/pages_controller.rb)
- [ ] T009 [P] [US2] Include `:site` in category-filtered `@pages` query in pages_controller#index (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/admin/cms/pages_controller.rb)
- [ ] T010 [P] [US2] Optimize redactor/rhino `index_for_redactor` path to avoid N+1 when traversing page tree by eager-loading `:site` where URLs are computed (/Users/petealbertson/Projects/comfortable-media-surfer/app/controllers/comfy/admin/cms/pages_controller.rb)

**Checkpoint**: Admin page listings/tree free of N+1 warnings.

---

## Phase 5: User Story 3 - Helper-driven views remain efficient (Priority: P3)

**Goal**: Typical helper usage for a single page remains efficient leveraging US1 eager-loading.

**Independent Test**: Render an app view using fragment helpers for a single page; expect zero N+1 warnings and attachments resolved without per-fragment queries.

### Implementation for User Story 3

- [ ] T011 [US3] Verify helper usage relies on preloaded page associations; document a brief note in README "Performance tips" on preferring content_cache for full bodies and using fragment helpers for simple values (/Users/petealbertson/Projects/comfortable-media-surfer/README.md)

**Checkpoint**: Helper-driven app layouts remain efficient without additional engine configuration.

---

## Phase N: Polish & Cross-Cutting Concerns

- [ ] T012 Update CHANGELOG.md Unreleased with bullet points for N+1 improvements and safe eager-loading defaults (/Users/petealbertson/Projects/comfortable-media-surfer/CHANGELOG.md)
- [ ] T013 [P] Add concise inline comments where `inverse_of` was introduced to explain the intent and avoid accidental removal (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/concerns/comfy/cms/with_fragments.rb)
- [ ] T014 [P] Add concise inline comments on `inverse_of` intent in app/models/comfy/cms/page.rb and translation.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/comfy/cms/page.rb)
- [ ] T015 [P] Add concise inline comments on `inverse_of` intent in app/models/comfy/cms/translation.rb (/Users/petealbertson/Projects/comfortable-media-surfer/app/models/comfy/cms/translation.rb)

---

## Dependencies & Execution Order

### Phase Dependencies
- Setup → Foundational → User Stories (US1 → US2 → US3) → Polish
- Foundational tasks (T002–T004) can run in parallel.
- Within US1, T006 and T007 can run in parallel after T005 baseline changes are drafted.
- Within US2, T009 and T010 can run in parallel.
- Polish tasks marked [P] can run in parallel.

### User Story Dependencies
- US1 (P1): Independent after Foundational
- US2 (P2): Independent after Foundational
- US3 (P3): Depends on US1 completion

### Parallel Examples
- Launch T002–T004 together (distinct files)
- After T005, launch T006 and T007 together
- Launch T009 and T010 together

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phase 2 (Foundational)
2. Implement T005–T007
3. Validate via quickstart.md P1 scenario

### Incremental Delivery
1. Deliver US1 → Validate → Commit
2. Deliver US2 → Validate → Commit
3. Deliver US3 (docs) → Validate

