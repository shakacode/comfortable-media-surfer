# Changelog

All notable changes to this project's source code will be documented in this file. Items under `Unreleased` are upcoming features that will be out in the next version.

## Contributors

Please follow the recommendations outlined at [keepachangelog.com](https://keepachangelog.com). Please use the existing headings and styling as a guide, and add a link for the version diff at the bottom of the file. Also, please update the `Unreleased` link to compare it to the latest release version.

For all changes prior to the inception of this project, see the [Release History](https://github.com/comfy/comfortable-mexican-sofa/releases) of ComfortableMexicanSofa.

## Versions

## [Unreleased]

- [Remove sassc sprockets](https://github.com/shakacode/comfortable-media-surfer/pull/4)

## [3.1.0] - 2024-12-26

### Added

- Deprecated Rails 6.x support, since it is not being maintained as of October 2024
- Added compatibility and support for Rails 8
- Added documentation to README for converting from the older CMSs
- Updated README links to the Surfer wiki

## [3.0.0] - 2024-11-30

First release of `comfortable_media_surfer`.  This new gem is a revival of [ComfortableMexicanSofa](https://github.com/comfy/comfortable-mexican-sofa) which had been dormant for nearly 5 years.

### Fixed

- Fixed all broken tests to now pass on Rails 6.x and 7.x
- Rubocop linting

### Added

- Rails 7 compatibility, including many config and code changes.  See the [PR](https://github.com/shakacode/comfortable-media-surfer/pull/1/files) for full details
- Added github actions workflows for CI build and test coverage
- Added CMS tags for navigation: children, siblings, breadcrumbs, with tests
- Added CMS tag for embedded audio, with tests
- Added CMS tag for image, with tests
- Added ability to write CMS snippets in Markdown, with tests

### Changed

- Rebranded ComfortableMexicanSofa as ComfortableMediaSurfer in to publish gem.  All database table names and schema remain unchanged
- Rails 5 compatibility dropped, as it is EOL
  