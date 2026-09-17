# Comfortable Media Surfer agent workflow

This repository is a Ruby on Rails engine. `master` is the default branch.

## Setup

For the human-facing development setup, including the development database and
browser-driver prerequisite, follow `CONTRIBUTING.md`. The GitHub Actions
matrix uses Node dependencies and the Rails 7.2, 8.0, and 8.1 Gemfiles. Before
running a command with a target Gemfile, install that selected bundle:

```bash
npm ci
BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle install
```

## Validation

Run focused tests while iterating. Before requesting review for a code change,
run the checks relevant to the affected Rails version. The Rails 8.1 CI job
uses:

```bash
npm ci
BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle install
BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rails comfy:compile_assets
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rails db:drop
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rails db:create
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rails db:migrate
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rake test
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rubocop --parallel
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec brakeman -q -w3
RAILS_ENV=test BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec bundler-audit --update --gemfile-lock gemfiles/8.1.gemfile.lock
```

For browser-facing changes, ensure a compatible Chrome or Chromium browser is
installed, then also run:

```bash
BUNDLE_GEMFILE=gemfiles/8.1.gemfile bin/bundle exec rake test:system
```

## Pull requests and merge authority

Create a focused feature branch and pull request; never push directly to
`master`. Keep the PR description clear about the user-visible outcome and the
validation performed. GitHub Actions runs Rails CI, coverage, and an automated
Claude Code review on pull requests. Read and address applicable review
feedback before claiming readiness.

Merge authority is **Ask**: do not merge a pull request unless a maintainer
explicitly authorizes the exact reviewed head after required checks and reviews
are complete.

## Shared workflow seam

Installed shared skills resolve this repository's workflow through this file.
The commands above are the authoritative setup and validation seam; capabilities
without a documented repository command are not assumed.
