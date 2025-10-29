# Comfortable Media Surfer Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

<!--
Sync Impact Report
- Version change: n/a → 1.0.0
- Modified principles:
	- Conventions over Configuration
	- Pragmatic Performance
	- Backwards Compatibility & Deprecations
	- Small Surface Area & Simplicity
	- Reliability & Testability
	- Documentation & Discoverability
- Added sections: None (filled existing template sections)
- Removed sections: None
- Templates reviewed for alignment:
	- ✅ .specify/templates/plan-template.md (no change required)
	- ✅ .specify/templates/spec-template.md (no change required)
	- ✅ .specify/templates/tasks-template.md (no change required)
	- ⚠ .specify/templates/commands/* (directory not present in repo)
	- ✅ README.md (informational; no contradictions detected)
	- ✅ CLAUDE.md (informational; aligns with principles)
- Deferred TODOs: None
-->

## Core Principles

### Conventions over Configuration
Our defaults MUST favor established Rails/engine conventions and a stable, unsurprising
project structure. Configuration SHOULD be minimal, optional, and additive—not required
for basic use. Public APIs MUST be conventional, clearly named, and kept small to reduce
maintenance burden.

Rationale: Convention-driven defaults reduce decision fatigue, lower defects, and make the
engine easier to adopt and upgrade.

### Pragmatic Performance
The engine MUST ship with sane, non-breaking performance defaults. Specifically:
- N+1 queries MUST be eliminated in hot paths (admin listings, public page render) via safe
	eager loading and association hygiene.
- Page rendering SHOULD use cached, pre-rendered content when appropriate to avoid repeated
	parsing and expansion.
- Optimizations MUST remain simple; avoid premature complexity. Measure before and after.

Rationale: Performance matters, but simplicity wins long term. Focus on high-impact, low-risk
optimizations that help every host app by default.

### Backwards Compatibility & Deprecations
Public behavior and APIs MUST remain backward compatible within a major version. When change
is necessary:
- Introduce deprecations in a minor release with documented migration guidance.
- Remove deprecated behavior only in the next major release.
- Clearly communicate behavior changes in CHANGELOG and docs.

Rationale: Host apps depend on stability. Predictable change management protects integrators.

### Small Surface Area & Simplicity
Expose the fewest public concepts necessary. Prefer small, cohesive modules over sprawling
options. Remove dead paths and reduce configuration branching over time.

Rationale: A smaller surface lowers cognitive load, reduces bugs, and makes performance and
security easier to reason about.

### Reliability & Testability
Changes MUST include tests for critical behavior (e.g., page rendering, layout/fragment flows,
permissions). Quality gates MUST prevent shipping regressions in rendering correctness or
query behavior. Tests SHOULD be fast and focused; integration tests SHOULD cover cross-component
contracts.

Rationale: Reliability is non-negotiable. Tests are the contract that keeps the engine
upgradeable.

### Documentation & Discoverability
Document public behavior and typical host-app integration patterns. Provide concise examples
for common tasks. CHANGELOG entries MUST accompany user-impacting changes. Inline docs SHOULD
clarify non-obvious behavior and constraints.

Rationale: Clear docs reduce support load and guide correct use of the engine.

## Operating Standards
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

The following standards guide day-to-day decisions and reviews:

- Rendering Path: Prefer serving pre-rendered page content when appropriate to minimize CPU and
	database load. Dynamic overrides must not pollute persisted caches.
- Data Access: Controllers and helpers MUST avoid N+1 queries. Use safe eager loading where
	the view path relies on associated data (e.g., site, layout, fragments, and attachments).
- Caching: Use straightforward caching strategies. Cache invalidation MUST be tied to content
	changes to prevent stale content. Prefer correctness over aggressive caching.
- Internationalization: Translation-related lookups MUST avoid per-record queries on index/list
	views by using appropriate eager loading where those associations are displayed.
- Security & Privacy: Default to least privilege in admin surfaces. Inputs and outputs MUST be
	validated and encoded appropriately.

## Development Workflow & Quality Gates
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

- Pull Requests MUST state any user-visible behavior change and link to related docs/CHANGELOG.
- Constitution Check: Implementation plans MUST verify alignment with the Core Principles and
	Operating Standards above before proceeding with design and changes.
- Quality Gates MUST include:
	- No critical regressions in rendering behavior (including cache correctness)
	- No introduced N+1s in reviewed paths
	- Tests added/updated for changed behavior
	- Documentation updated for affected public behavior
- Release Discipline:
	- Patch: Bug fixes and clarifications
	- Minor: Additive features and deprecations (no breaking changes)
	- Major: Breaking changes only with prior deprecation path

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

This Constitution governs engineering decisions for Comfortable Media Surfer. In case of
conflict with existing habits or documents, this Constitution prevails.

Amendments:
- Propose via Pull Request including: summary of changes, rationale, expected impact, and
	migration considerations if applicable.
- Approval requires maintainer review and consensus (documented in the PR).
- Upon merge, update Version and Last Amended date; summarize in the Sync Impact Report block
	at the top of this file.

Versioning Policy (of the Constitution):
- MAJOR: Redefining or removing principles/sections (backward-incompatible governance changes)
- MINOR: Adding or materially expanding principles/sections
- PATCH: Clarifications, wording, or non-semantic refinements

Compliance:
- All PRs MUST assert compliance with Core Principles and Operating Standards.
- Reviews MUST block changes that introduce avoidable complexity or performance regressions.

**Version**: 1.0.0 | **Ratified**: 2025-10-29 | **Last Amended**: 2025-10-29
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->

# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: Every feature starts as a standalone library; Libraries must be self-contained, independently testable, documented; Clear purpose required - no organizational-only libraries -->

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: Every library exposes functionality via CLI; Text in/out protocol: stdin/args → stdout, errors → stderr; Support JSON + human-readable formats -->

### [PRINCIPLE_3_NAME]
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: TDD mandatory: Tests written → User approved → Tests fail → Then implement; Red-Green-Refactor cycle strictly enforced -->

### [PRINCIPLE_4_NAME]
<!-- Example: IV. Integration Testing -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Focus areas requiring integration tests: New library contract tests, Contract changes, Inter-service communication, Shared schemas -->

### [PRINCIPLE_5_NAME]
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
[PRINCIPLE_5_DESCRIPTION]
<!-- Example: Text I/O ensures debuggability; Structured logging required; Or: MAJOR.MINOR.BUILD format; Or: Start simple, YAGNI principles -->

## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
