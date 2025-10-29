# Implementation Plan: N+1 Performance Quick Wins

**Branch**: `001-specify-scripts-bash` | **Date**: 2025-10-29 | **Spec**: /Users/petealbertson/Projects/comfortable-media-surfer/specs/001-specify-scripts-bash/spec.md
**Input**: Feature specification from `/specs/001-specify-scripts-bash/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Goal: Deliver non-breaking performance improvements that eliminate N+1 queries in public page
rendering and admin pages listings by introducing safe eager-loading defaults, association
hygiene, and cache-correct usage in the engine. Keep behavior stable and aligned with
conventions-over-configuration.

Phase Outputs:
- research.md: Decisions on safe eager-loading, association hygiene, cache usage
- data-model.md: Entities affected and relationship notes (no schema changes)
- quickstart.md: Steps to validate P1/P2/P3 scenarios locally
- contracts/: Informational note (no external API)

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Ruby 3.2–3.4; Rails 7.1–8.0 (engine compatible)
**Primary Dependencies**: Rails (ActiveRecord, ActiveStorage), Comfortable Media Surfer engine
**Storage**: Host app database; ActiveStorage for attachments
**Testing**: Minitest (unit/integration/system); Capybara/Cuprite for system tests
**Target Platform**: Ruby on Rails applications (engine mounted)
**Project Type**: Rails engine
**Performance Goals**: Zero N+1 warnings in specified scenarios (public render, admin tree);
stable query counts regardless of fragment count; equal or improved server render time
**Constraints**: Non-breaking changes; safe defaults; cache correctness; minimal configuration
**Scale/Scope**: Applies to all host apps using the engine; impacts public and admin page paths

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Aligned Principles:
- Conventions over Configuration: Ship eager-loading defaults; no new required settings.
- Pragmatic Performance: Target hot paths with simple, safe eager-loading and association fixes.
- Backwards Compatibility: No API breaks; behavior preserved with additive internal changes.
- Small Surface Area: Avoid adding knobs; keep the public surface minimal.
- Reliability & Testability: Add tests/validation for query behavior and render correctness.

Gate Evaluation (PASS): The planned changes are additive, default-on, and non-breaking, with
tests and documentation updates.

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: Single Rails engine. Changes touch:
- app/controllers/comfy/cms/content_controller.rb (public rendering path)
- app/controllers/comfy/admin/cms/pages_controller.rb (admin pages index/tree)
- app/models/** (association hygiene where needed)
- docs/CHANGELOG.md (documentation)

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

