# Contributing

Contribute your code to ComfortableMediaSurfer in 5 easy steps:

### 1. Fork it

Fork the project. Optionally, create a branch you want to work on.

### 2. Get it running locally

- Install gem dependencies with `bundle install`
- There's nothing to configure, by default database is SQLite so it will be
  created for you. Just run `bundle exec rake db:migrate`
- Prepare the environment by running `rails comfy:compile_assets`, and
  `rake db:test:prepare`
- Make sure that existing tests are passing by running `bundle exec rake test`.
  This uses six isolated workers by default, merges their coverage, and records
  per-file runtimes in `tmp/parallel_runtime_test.log` for future balancing.
  Set `PARALLEL_WORKERS` to tune the worker count, or run
  `bundle exec rake test:serial` for a serial coverage run.
- There are system tests that can be run with `bundle exec rake test:system`.
  You need to have `chromedriver` installed for that.
- You should be able to start the app via `bin/rails s` and navigate to http://localhost:3000/admin
  and log in with username 'user' and password 'pass'

### 3. Hack away

- Create a few small pull requests instead of a humoungous one. I can merge small stuff faster.
- When adding new code just make sure it follows the same style as the existing code.
- Avoid adding 3rd party dependencies if you can.
- Tests please, but nothing complicated. UnitTest / Fixtures all the way. Make sure all tests pass.
- Run `bundle exec rubocop` and fix any issues raised.

### 4. Make a pull request

- If you never done it before read this: https://help.github.com/articles/using-pull-requests
- When PR is submitted check if Github actions CI ran all tests successfully

### 5. Done!

If everything is good your changes will be merged into master branch. Eventually
a new version of gem will be published.

## Maintainer release process

Prepare a versioned `CHANGELOG.md` section before releasing. With no version
argument, the release task uses a newer changelog version or falls back to the
next patch version.

Rehearse the release from a clean checkout:

```sh
bundle exec rake "release[3.2.0,true]"
```

The dry run fetches `origin/master`, creates a temporary worktree, checks the
release version and changelog policy, reports the exact-commit GitHub Actions
status, bumps the version, and builds the gem without changing the maintainer's
checkout.

Run the live release from a clean, up-to-date `master` branch:

```sh
bundle exec rake "release[3.2.0]"
```

The live task requires GitHub write access, green `Rails CI` and `Coveralls`
push workflows for the exact commit, and confirmation before it commits and
tags the version. It pushes the release commit and tag, publishes the gem to
RubyGems, and creates or updates the GitHub release from the matching changelog
section. Beta and RC versions are marked as GitHub prereleases. `create_release`
remains available as a backward-compatible task name.

Use `RELEASE_CI_STATUS_OVERRIDE=true` only for a known unrelated CI outage. If
RubyGems publication fails after the release tag is pushed, retry safely with:

```sh
bundle exec rake "publish_rubygems[3.2.0]"
```

The recovery task verifies that the local and remote tags point at `HEAD` and
does nothing if that version is already on RubyGems. If RubyGems publishing
succeeds but GitHub release synchronization fails, recover with:

```sh
bundle exec rake "sync_github_release[3.2.0]"
```
