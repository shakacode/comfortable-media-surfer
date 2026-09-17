# frozen_string_literal: true

require 'minitest/autorun'
require 'open3'
require 'tmpdir'
require 'rake'
load File.expand_path('../../rakelib/release.rake', __dir__)

class ReleaseTest < Minitest::Test
  def test_resolves_newer_changelog_version_before_patch_fallback
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.7', changelog: "## [v3.2.0] - 2026-09-16\n")

      assert_equal '3.2.0', ComfortableMediaSurferRelease.resolve_version(root:, requested: nil)
    end
  end

  def test_falls_back_to_next_patch_when_changelog_has_no_new_version
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.7', changelog: "## [v3.1.7] - 2026-02-20\n")

      assert_equal '3.1.8', ComfortableMediaSurferRelease.resolve_version(root:, requested: '')
    end
  end

  def test_requires_an_explicit_version_when_current_version_is_a_prerelease
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.2.0.rc.0', changelog: "## [v3.2.0-rc.0] - 2026-09-16\n")

      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.resolve_version(root:, requested: nil)
      end

      assert_match(%r{current version is 3\.2\.0\.rc\.0}, error.message)
    end
  end

  def test_rejects_versions_that_are_not_newer_than_the_latest_tag
    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_version_policy!(target: '3.1.7', tagged_versions: %w[3.1.6 3.1.7])
    end

    assert_match(%r{must be greater than latest tagged version 3\.1\.7}, error.message)
  end

  def test_rejects_a_patch_version_for_changelog_features
    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_version_policy!(
        target: '3.1.8',
        tagged_versions: %w[3.1.7],
        changelog_section: "### Added\n\n- A new capability."
      )
    end

    assert_match(%r{requires a minor bump}, error.message)
  end

  def test_accepts_a_minor_version_for_changelog_features
    assert ComfortableMediaSurferRelease.validate_version_policy!(
      target: '3.2.0',
      tagged_versions: %w[3.1.7],
      changelog_section: "### Added\n\n- A new capability."
    )
  end

  def test_removed_changelog_entries_require_a_major_version
    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_version_policy!(
        target: '3.2.0',
        tagged_versions: %w[3.1.7],
        changelog_section: "### Removed\n\n- Legacy support."
      )
    end

    assert_match(%r{requires a major bump}, error.message)
  end

  def test_extracts_release_notes_without_the_next_version
    changelog = <<~MARKDOWN
      ## [Unreleased]

      ## [v3.2.0] - 2026-09-16

      ### Added

      - Safer releases.

      ## [v3.1.7] - 2026-02-20

      ### Fixed

      - Earlier fix.
    MARKDOWN

    assert_equal "### Added\n\n- Safer releases.",
                 ComfortableMediaSurferRelease.extract_changelog_section(changelog:, version: '3.2.0')
  end

  def test_live_release_requires_a_matching_changelog_section
    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_changelog_presence!(notes: nil, version: '3.2.0', dry_run: false)
    end

    assert_match(%r{Add release notes before publishing}, error.message)
  end

  def test_dry_run_allows_a_missing_changelog_section
    refute ComfortableMediaSurferRelease.validate_changelog_presence!(
      notes: nil,
      version: '3.2.0',
      dry_run: true
    )
  end

  def test_ci_gate_requires_all_expected_workflows_to_finish_successfully
    runs = [
      { 'name' => 'Rails CI', 'status' => 'completed', 'conclusion' => 'success' },
      { 'name' => 'Coveralls', 'status' => 'in_progress', 'conclusion' => nil }
    ]

    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_ci_runs!(runs:)
    end

    assert_match(%r{Coveralls \(in_progress\)}, error.message)
  end

  def test_ci_gate_uses_only_the_latest_run_for_each_workflow
    runs = [
      { 'name' => 'Rails CI', 'status' => 'completed', 'conclusion' => 'success', 'created_at' => '2026-09-16T02:00:00Z' },
      { 'name' => 'Rails CI', 'status' => 'completed', 'conclusion' => 'failure', 'created_at' => '2026-09-16T01:00:00Z' },
      { 'name' => 'Coveralls', 'status' => 'completed', 'conclusion' => 'success', 'created_at' => '2026-09-16T02:00:00Z' }
    ]

    assert ComfortableMediaSurferRelease.validate_ci_runs!(runs:)
  end

  def test_github_repo_slug_accepts_supported_github_remotes
    assert_equal 'shakacode/comfortable-media-surfer',
                 ComfortableMediaSurferRelease.github_repo_slug('git@github.com:shakacode/comfortable-media-surfer.git')
    assert_equal 'shakacode/comfortable-media-surfer',
                 ComfortableMediaSurferRelease.github_repo_slug(
                   'https://github.com/shakacode/comfortable-media-surfer.git'
                 )
    assert_equal 'shakacode/comfortable-media-surfer',
                 ComfortableMediaSurferRelease.github_repo_slug(
                   'ssh://git@github.com:443/shakacode/comfortable-media-surfer.git'
                 )
  end

  def test_github_repo_slug_rejects_other_hosts
    assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.github_repo_slug('https://example.com/shakacode/comfortable-media-surfer.git')
    end
  end

  def test_new_prerelease_command_marks_the_github_release_as_a_prerelease
    command = ComfortableMediaSurferRelease.github_release_command(
      tag: 'v3.2.0.rc.0',
      repo: 'shakacode/comfortable-media-surfer',
      notes_file: '/tmp/notes.md',
      prerelease: true,
      exists: false
    )

    assert_includes command, '--prerelease'
  end

  def test_existing_stable_release_command_clears_the_prerelease_flag
    command = ComfortableMediaSurferRelease.github_release_command(
      tag: 'v3.2.0',
      repo: 'shakacode/comfortable-media-surfer',
      notes_file: '/tmp/notes.md',
      prerelease: false,
      exists: true
    )

    assert_includes command, '--prerelease=false'
  end

  def test_rubygems_version_parser_handles_all_remote_versions
    output = 'comfortable_media_surfer (3.2.0.rc.0, 3.1.8, 3.1.7)'
    command = nil
    runner = ->(*args, chdir:) do
      command = [args, chdir]
      output
    end

    ComfortableMediaSurferRelease.stub(:run!, runner) do
      assert_equal %w[3.2.0.rc.0 3.1.8 3.1.7], ComfortableMediaSurferRelease.rubygems_versions(root: '/tmp')
    end
    assert_includes command.first, '--prerelease'
  end

  def test_rubygems_recovery_is_idempotent_when_version_is_already_published
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')

      ComfortableMediaSurferRelease.stub(:rubygems_versions, ['3.1.8']) do
        assert_equal :already_published,
                     ComfortableMediaSurferRelease.publish_to_rubygems!(
                       root:,
                       version: '3.1.8',
                       allow_existing: true
                     )
      end
    end
  end

  def test_normal_rubygems_publication_rejects_an_existing_version
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')

      ComfortableMediaSurferRelease.stub(:rubygems_versions, ['3.1.8']) do
        error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
          ComfortableMediaSurferRelease.publish_to_rubygems!(root:, version: '3.1.8')
        end
        assert_match(%r{potentially different artifact}, error.message)
      end
    end
  end

  def test_rubygems_recovery_dry_run_does_not_query_remote_versions
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')
      queried = false
      replacement = ->(root:) do
        queried = !root.nil?
        []
      end

      ComfortableMediaSurferRelease.stub(:rubygems_versions, replacement) do
        assert_equal :dry_run,
                     ComfortableMediaSurferRelease.publish_to_rubygems!(root:, version: '3.1.8', dry_run: true)
      end
      refute queried
    end
  end

  def test_rubygems_publication_only_builds_and_pushes_the_existing_version
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')
      command = nil
      runner = ->(*args, chdir:) do
        command = [args, chdir] if args.first == 'bundle'
        ''
      end

      ComfortableMediaSurferRelease.stub(:run!, runner) do
        ComfortableMediaSurferRelease.stub(:rubygems_versions, []) do
          ComfortableMediaSurferRelease.publish_to_rubygems!(root:, version: '3.1.8')
        end
      end

      assert_equal [%w[bundle exec gem release], root], command
    end
  end

  def test_github_release_lookup_distinguishes_not_found_from_transient_errors
    status = Struct.new(:success?).new(false)

    Open3.stub(:capture2e, ["gh: Not Found (HTTP 404)\n", status]) do
      refute ComfortableMediaSurferRelease.github_release_exists?(
        root: '/release', repo: 'shakacode/comfortable-media-surfer', tag: 'v3.2.0'
      )
    end

    error = Open3.stub(:capture2e, ["gh: API rate limit exceeded (HTTP 403)\n", status]) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.github_release_exists?(
          root: '/release', repo: 'shakacode/comfortable-media-surfer', tag: 'v3.2.0'
        )
      end
    end
    assert_match(%r{rate limit exceeded}, error.message)
  end

  def test_release_pushes_branch_and_tag_atomically
    commands = []
    runner = ->(*command, chdir:) do
      commands << [command, chdir]
      ''
    end

    ComfortableMediaSurferRelease.stub(:run!, runner) do
      ComfortableMediaSurferRelease.stub(:publish_to_rubygems!, :published) do
        ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
      end
    end

    assert_includes commands, [%w[git push --atomic origin master v3.2.0], '/release']
  end

  def test_push_response_failure_continues_when_remote_refs_confirm_success
    commands = []
    runner = ->(*command, chdir:) do
      commands << [command, chdir]
      return 'release-head' if command == %w[git rev-parse HEAD]
      raise ComfortableMediaSurferRelease::ReleaseError, 'lost push response' if command.include?('push')

      ''
    end
    published = false

    _output, warnings = capture_io do
      ComfortableMediaSurferRelease.stub(:run!, runner) do
        ComfortableMediaSurferRelease.stub(:remote_release_state, :published) do
          publisher = ->(**) { published = true }
          ComfortableMediaSurferRelease.stub(:publish_to_rubygems!, publisher) do
            ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
          end
        end
      end
    end

    assert published
    assert_match(%r{continuing with publication}, warnings)
    refute(commands.any? { |command, _root| command.first(3) == %w[git tag -d] })
  end

  def test_remote_release_state_requires_both_branch_and_tag_to_match
    status = Struct.new(:success?).new(true)
    complete = <<~OUTPUT
      release-head\trefs/heads/master
      tag-object\trefs/tags/v3.2.0
      release-head\trefs/tags/v3.2.0^{}
    OUTPUT
    partial = "release-head\trefs/heads/master\n"

    Open3.stub(:capture2e, [complete, status]) do
      assert_equal :published,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release', release_head: 'release-head', tag: 'v3.2.0'
                   )
    end
    Open3.stub(:capture2e, [partial, status]) do
      assert_equal :unknown,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release', release_head: 'release-head', tag: 'v3.2.0'
                   )
    end
  end

  def test_unknown_push_result_preserves_local_release_state
    runner = ->(*command, chdir:) do
      return 'release-head' if command == %w[git rev-parse HEAD]
      raise ComfortableMediaSurferRelease::ReleaseError, "lost push response in #{chdir}" if command.include?('push')

      ''
    end

    error = ComfortableMediaSurferRelease.stub(:run!, runner) do
      ComfortableMediaSurferRelease.stub(:remote_release_state, :unknown) do
        assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
          ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
        end
      end
    end

    assert_match(%r{local release commit and tag were preserved}, error.message)
  end

  def test_git_failure_does_not_report_rubygems_recovery
    runner = ->(*command, chdir:) do
      raise ComfortableMediaSurferRelease::ReleaseError, "push failed in #{chdir}" if command.include?('push')

      ''
    end

    _output, errors = capture_io do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
        end
      end
    end

    refute_match(%r{RubyGems publication failed}, errors)
  end

  def test_git_failure_rolls_back_the_release_commit_tag_and_version_file
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)
      original_head = run_git(checkout, 'rev-parse', 'HEAD').strip
      original_contents = File.read(File.join(checkout, 'lib/comfortable_media_surfer/version.rb'))
      ComfortableMediaSurferRelease.bump_and_validate!(root: checkout, version: '3.1.8')

      original_run = ComfortableMediaSurferRelease.method(:run!)
      runner = ->(*command, chdir:) do
        if command == %w[git push --atomic origin master v3.1.8]
          raise ComfortableMediaSurferRelease::ReleaseError, 'simulated atomic push failure'
        end

        original_run.call(*command, chdir:)
      end

      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          ComfortableMediaSurferRelease.stub(:remote_release_state, :not_published) do
            ComfortableMediaSurferRelease.publish_release!(
              root: checkout,
              version: '3.1.8',
              original_version_contents: original_contents
            )
          end
        end
      end

      assert_equal original_head, run_git(checkout, 'rev-parse', 'HEAD').strip
      assert_equal original_contents, File.read(File.join(checkout, 'lib/comfortable_media_surfer/version.rb'))
      assert_empty run_git(checkout, 'tag', '--list', 'v3.1.8').strip
      assert_empty run_git(checkout, 'status', '--porcelain').strip
    end
  end

  def test_dry_run_builds_in_a_throwaway_worktree_and_leaves_checkout_unchanged
    Dir.mktmpdir do |sandbox|
      origin = File.join(sandbox, 'origin.git')
      seed = File.join(sandbox, 'seed')
      checkout = File.join(sandbox, 'checkout')
      run_git(sandbox, 'init', '--bare', '--initial-branch=master', origin)
      run_git(sandbox, 'init', '--initial-branch=master', seed)
      write_minimal_gem(seed)
      run_git(seed, 'add', '.')
      run_git(seed, '-c', 'user.name=Release Test', '-c', 'user.email=release@example.com',
              'commit', '-m', 'Initial release')
      run_git(seed, 'tag', 'v3.1.7')
      run_git(seed, 'remote', 'add', 'origin', origin)
      run_git(seed, 'push', '--tags', 'origin', 'master')
      run_git(sandbox, 'clone', origin, checkout)

      result = ComfortableMediaSurferRelease.perform(
        root: checkout,
        requested_version: '3.1.8',
        dry_run: true,
        ci_override: false
      )

      assert_equal '3.1.8', result.fetch(:version)
      assert_equal '3.1.7', ComfortableMediaSurferRelease.current_version(checkout)
      assert_empty run_git(checkout, 'branch', '--list', 'release-dry-run-*').strip
      assert_empty run_git(checkout, 'status', '--porcelain').strip
    end
  end

  def test_tag_checkout_recovers_the_release_after_master_advances
    Dir.mktmpdir do |sandbox|
      origin, seed, checkout = create_git_release_fixture(sandbox)
      File.write(File.join(seed, 'later.txt'), "later\n")
      run_git(seed, 'add', 'later.txt')
      run_git(seed, '-c', 'user.name=Release Test', '-c', 'user.email=release@example.com',
              'commit', '-m', 'Advance master')
      run_git(seed, 'push', 'origin', 'master')
      run_git(checkout, 'pull', '--ff-only')

      ComfortableMediaSurferRelease.with_tag_checkout(root: checkout, version: '3.1.7') do |release_root|
        assert_equal '3.1.7', ComfortableMediaSurferRelease.current_version(release_root)
        assert_equal run_git(release_root, 'rev-parse', 'HEAD'), run_git(release_root, 'rev-list', '-n', '1', 'v3.1.7')
      end

      assert_empty run_git(checkout, 'status', '--porcelain').strip
      assert File.directory?(origin)
    end
  end

private

  def write_release_files(root, version:, changelog:)
    version_dir = File.join(root, 'lib', 'comfortable_media_surfer')
    FileUtils.mkdir_p(version_dir)
    File.write(
      File.join(version_dir, 'version.rb'),
      "module ComfortableMediaSurfer\n  VERSION = '#{version}'\nend\n"
    )
    File.write(File.join(root, 'CHANGELOG.md'), changelog)
  end

  def write_minimal_gem(root)
    write_release_files(
      root,
      version: '3.1.7',
      changelog: "## [v3.1.8] - 2026-09-16\n\n### Fixed\n\n- Safer releases.\n"
    )
    File.write(File.join(root, 'comfortable_media_surfer.gemspec'), <<~RUBY)
      require_relative 'lib/comfortable_media_surfer/version'
      Gem::Specification.new do |spec|
        spec.name = 'comfortable_media_surfer'
        spec.version = ComfortableMediaSurfer::VERSION
        spec.summary = 'Release test gem'
        spec.authors = ['ShakaCode']
        spec.files = ['lib/comfortable_media_surfer/version.rb']
      end
    RUBY
  end

  def create_git_release_fixture(sandbox)
    origin = File.join(sandbox, 'origin.git')
    seed = File.join(sandbox, 'seed')
    checkout = File.join(sandbox, 'checkout')
    run_git(sandbox, 'init', '--bare', '--initial-branch=master', origin)
    run_git(sandbox, 'init', '--initial-branch=master', seed)
    write_minimal_gem(seed)
    run_git(seed, 'add', '.')
    run_git(seed, '-c', 'user.name=Release Test', '-c', 'user.email=release@example.com',
            'commit', '-m', 'Initial release')
    run_git(seed, 'tag', 'v3.1.7')
    run_git(seed, 'remote', 'add', 'origin', origin)
    run_git(seed, 'push', '--tags', 'origin', 'master')
    run_git(sandbox, 'clone', origin, checkout)
    [origin, seed, checkout]
  end

  def run_git(directory, *)
    output, status = Open3.capture2e('git', *, chdir: directory)
    raise output unless status.success?

    output
  end
end
