# Changelog

All notable changes to this project's source code will be documented in this file. Items under `Unreleased` are upcoming features that will be out in the next version.

## Contributors

Please follow the recommendations outlined at [keepachangelog.com](https://keepachangelog.com). Please use the existing headings and styling as a guide, and add a link for the version diff at the bottom of the file. Also, please update the `Unreleased` link to compare it to the latest release version.

For all changes prior to the inception of this project, see the [Release History](https://github.com/comfy/comfortable-mexican-sofa/releases) of ComfortableMexicanSofa.

## Versions

## [Unreleased]

## [v3.1.3] - 2025-05-29

### Fixed

- Fixed file descriptor leak during seeds import
- Fixed ‘Deep nesting of tags’ error for pages containing more than MAX_DEPTH tags
- Fixed importing pages with the same slug but different parents

## [v3.1.2] - 2025-05-26

### Fixed

- Fixed Expand/Collapse error in Admin/Pages.
- Include sassc-rails to gemspec, since it is deprecated after rails 7.0.8
- Update documentation to reflect recent changes

### Added

- added migration for Markdown snippets

## [v3.1.1] - 2025-02-08

### Fixed

- Fixed scss: use scss imports, not css ones that cannot be resolved by the browser

### Added

- Added rake task to compile assets, corresponding post install message
- Added import Rails from UJS
- Added missing jQuery import

### Removed

- Removed yarn, as not needed

## [v3.1.0] - 2024-12-31 (gem yanked, pending resolution of [Issue 8](https://github.com/shakacode/comfortable-media-surfer/issues/8)

### Added

- Added compatibility and support for Rails 8
- Added compatibility and support for propshaft (sprockets is still supported) - installing the gem now requires NodeJS to be installed. In addition, the `comfy:compile_assets` task needs to be run after installing the gem.

### Removed

- Removed sassc sprockets
- Rails 6.x compatibility dropped, since it is not being maintained as of October 2024

### Changed

- Updated README links to point to the Surfer wiki

## [v3.0.0] - 2024-11-30

First release of `comfortable_media_surfer`. This new gem is a revival of [ComfortableMexicanSofa](https://github.com/comfy/comfortable-mexican-sofa) which had been dormant for nearly 5 years.

### Fixed

- Fixed all broken tests to now pass on Rails 6.x and 7.x
- Code syntax per Rubocop linting

### Added

- Rails 7 compatibility, including many config and code changes. See the [PR](https://github.com/shakacode/comfortable-media-surfer/pull/1/files) for full details
- Added github actions workflows for CI build and test coverage
- Added CMS tags for navigation: children, siblings, breadcrumbs, with tests
- Added CMS tag for embedded audio, with tests
- Added CMS tag for image, with tests
- Added ability to write CMS snippets in Markdown, with tests

### Removed

- Rails 5 compatibility dropped, as it is EOL

### Changed

- Rebranded **ComfortableMexicanSofa** as **ComfortableMediaSurfer** in order to publish new gem (database table names and schema have not changed).

[Unreleased]: https://github.com/shakacode/comfortable-media-surfer/compare/v3.1.3...master
[v3.1.3]: https://github.com/shakacode/comfortable-media-surfer/compare/v3.1.2...v3.1.3
[v3.1.2]: https://github.com/shakacode/comfortable-media-surfer/compare/v3.1.1...v3.1.2
[v3.1.1]: https://github.com/shakacode/comfortable-media-surfer/compare/v3.1.0...v3.1.1
[v3.1.0]: https://github.com/shakacode/comfortable-media-surfer/compare/v3.0.0...v3.1.0
[v3.0.0]: https://github.com/shakacode/comfortable-media-surfer/compare/v2.0.19...v3.0.0
