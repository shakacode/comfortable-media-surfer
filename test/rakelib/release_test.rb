# frozen_string_literal: true

require 'minitest/autorun'
require 'open3'
require 'tmpdir'
require 'rake'
require 'stringio'
load File.expand_path('../../rakelib/release.rake', __dir__)

class ReleaseTest < Minitest::Test
  def test_truthy_preserves_the_legacy_t_alias
    assert ComfortableMediaSurferRelease.truthy?('t')
    assert ComfortableMediaSurferRelease.truthy?('T')
  end

  def test_confirmation_only_honors_the_namespaced_release_override
    original_auto_confirm = ENV.fetch('AUTO_CONFIRM', nil)
    original_release_auto_confirm = ENV.fetch('RELEASE_AUTO_CONFIRM', nil)
    original_stdin = $stdin
    ENV['AUTO_CONFIRM'] = 'true'
    ENV.delete('RELEASE_AUTO_CONFIRM')
    $stdin = StringIO.new("n\n")

    assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.confirm!('Release?')
    end

    ENV['RELEASE_AUTO_CONFIRM'] = 'true'
    assert_nil ComfortableMediaSurferRelease.confirm!('Release?')
  ensure
    ENV['AUTO_CONFIRM'] = original_auto_confirm
    ENV['RELEASE_AUTO_CONFIRM'] = original_release_auto_confirm
    $stdin = original_stdin
  end

  def test_release_confirmation_calls_out_a_ci_override
    prompt = ComfortableMediaSurferRelease.release_confirmation_prompt(version: '3.2.0', ci_state: :overridden)

    assert_match(%r{CI IS NOT GREEN}, prompt)
    assert_match(%r{RELEASE_CI_STATUS_OVERRIDE}, prompt)
  end

  def test_interactive_runner_distinguishes_a_missing_command
    ComfortableMediaSurferRelease.stub(:system, nil) do
      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.run_interactive!('missing-command', chdir: '/tmp')
      end

      assert_match(%r{Command not found: missing-command}, error.message)
    end
  end

  def test_interactive_runner_reports_a_failed_command
    ComfortableMediaSurferRelease.stub(:system, false) do
      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.run_interactive!('failing-command', chdir: '/tmp')
      end

      assert_match(%r{Command failed: failing-command}, error.message)
    end
  end

  def test_loading_release_tasks_twice_does_not_duplicate_actions
    capture_io { load File.expand_path('../../rakelib/release.rake', __dir__) }

    %i[release create_release sync_github_release publish_rubygems].each do |task_name|
      assert_equal 1, Rake::Task[task_name].actions.length, "expected one action for #{task_name}"
    end
  end

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

  def test_missing_release_files_raise_a_clean_release_error
    Dir.mktmpdir do |root|
      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.resolve_version(root:, requested: nil)
      end

      assert_match(%r{Required release file is missing}, error.message)
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

  def test_rejects_a_target_older_than_the_checked_in_version
    error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
      ComfortableMediaSurferRelease.validate_version_policy!(
        target: '3.1.8',
        current: '3.2.0',
        tagged_versions: %w[3.1.7]
      )
    end

    assert_match(%r{must not be older than checked-in version 3\.2\.0}, error.message)
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

  def test_changed_changelog_entries_do_not_force_a_patch_bump
    assert ComfortableMediaSurferRelease.validate_version_policy!(
      target: '3.2.0',
      tagged_versions: %w[3.1.7],
      changelog_section: "### Changed\n\n- Updated behavior."
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

  def test_workflow_runs_parses_the_complete_json_document
    output = <<~JSON
      [
        {"workflow_runs":[
          {"name":"Rails CI","status":"completed","conclusion":"success","created_at":"2026-09-16T02:00:00Z"}
        ]},
        {"workflow_runs":[
          {"name":"Coveralls","status":"completed","conclusion":"success","created_at":"2026-09-16T02:00:00Z"}
        ]}
      ]
    JSON
    command = nil
    runner = ->(*args, chdir:) do
      command = [args, chdir]
      output
    end

    runs = ComfortableMediaSurferRelease.stub(:repository_slug, 'shakacode/comfortable-media-surfer') do
      ComfortableMediaSurferRelease.stub(:run!, runner) do
        ComfortableMediaSurferRelease.workflow_runs(root: '/release', commit_sha: 'abc123')
      end
    end

    workflow_names = runs.map { |run| run.fetch('name') }
    assert_equal ['Rails CI', 'Coveralls'], workflow_names
    assert_includes command.first, '--paginate'
    assert_includes command.first, '--slurp'
    refute_includes command.first, '--jq'
    assert(command.first.any? { |part| part.include?('branch=master') })
  end

  def test_workflow_runs_rejects_entries_without_names
    output = '[{"workflow_runs":[{"status":"completed","conclusion":"success"}]}]'

    error = ComfortableMediaSurferRelease.stub(:run!, output) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.workflow_runs(
          root: '/release',
          commit_sha: 'abc123',
          repo: 'shakacode/comfortable-media-surfer'
        )
      end
    end

    assert_match(%r{did not contain valid pages}, error.message)
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

  def test_github_permission_check_ignores_stderr_warnings
    status = Struct.new(:success?).new(true)

    ComfortableMediaSurferRelease.stub(:repository_slug, 'shakacode/comfortable-media-surfer') do
      Open3.stub(:capture2e, ["authenticated\n", status]) do
        Open3.stub(:capture3, ["true\n", "upgrade warning\n", status]) do
          assert_nil ComfortableMediaSurferRelease.verify_gh_auth!('/release')
        end
      end
    end
  end

  def test_repository_slug_requires_matching_fetch_and_push_repositories
    matching_runner = ->(*command, chdir:) do
      assert_equal '/release', chdir
      if command.include?('--push')
        "git@github.com:shakacode/comfortable-media-surfer.git\n"
      else
        "https://github.com/shakacode/comfortable-media-surfer.git\n"
      end
    end
    ComfortableMediaSurferRelease.stub(:run!, matching_runner) do
      assert_equal 'shakacode/comfortable-media-surfer',
                   ComfortableMediaSurferRelease.repository_slug('/release')
    end

    mismatched_runner = ->(*command, chdir:) do
      assert_equal '/release', chdir
      if command.include?('--push')
        "git@github.com:other/project.git\n"
      else
        "git@github.com:shakacode/comfortable-media-surfer.git\n"
      end
    end
    error = ComfortableMediaSurferRelease.stub(:run!, mismatched_runner) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.repository_slug('/release')
      end
    end
    assert_match(%r{fetch repository .* does not match push repository}, error.message)
  end

  def test_repository_slug_rejects_multiple_push_destinations
    runner = ->(*command, chdir:) do
      assert_equal '/release', chdir
      if command.include?('--push')
        "git@github.com:shakacode/comfortable-media-surfer.git\n" \
          "git@github.com:backup/comfortable-media-surfer.git\n"
      else
        "git@github.com:shakacode/comfortable-media-surfer.git\n"
      end
    end

    error = ComfortableMediaSurferRelease.stub(:run!, runner) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.repository_slug('/release')
      end
    end

    assert_match(%r{exactly one push URL}, error.message)
  end

  def test_repository_slug_rejects_a_matching_fork
    runner = ->(*, chdir:) { "git@github.com:someone/comfortable-media-surfer.git\n" if chdir == '/release' }

    error = ComfortableMediaSurferRelease.stub(:run!, runner) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.repository_slug('/release')
      end
    end

    assert_match(%r{must run from shakacode/comfortable-media-surfer}, error.message)
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
    assert_includes command, '--draft=false'
  end

  def test_rubygems_version_parser_handles_all_remote_versions
    output = "warning: using fallback source\n  comfortable_media_surfer (3.2.0.rc.0, 3.1.8, 3.1.7)\n"
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

  def test_rubygems_version_parser_rejects_an_unrecognized_response
    runner = ->(*, chdir:) { "warning: service response changed for #{chdir}\n" }

    error = ComfortableMediaSurferRelease.stub(:run!, runner) do
      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.rubygems_versions(root: '/tmp')
      end
    end

    assert_match(%r{did not include comfortable_media_surfer versions}, error.message)
  end

  def test_failed_preflight_build_restores_the_original_version_file
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.7', changelog: '')
      original_contents = File.read(File.join(root, 'lib/comfortable_media_surfer/version.rb'))
      runner = ->(*command, chdir:) do
        raise ComfortableMediaSurferRelease::ReleaseError, "build failed in #{chdir}" if command.first == 'gem'

        ''
      end

      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          ComfortableMediaSurferRelease.bump_and_validate!(root:, version: '3.1.8')
        end
      end

      assert_equal original_contents, File.read(File.join(root, 'lib/comfortable_media_surfer/version.rb'))
    end
  end

  def test_unexpected_preflight_failure_restores_the_original_version_file
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.7', changelog: '')
      path = File.join(root, 'lib/comfortable_media_surfer/version.rb')
      original_contents = File.read(path)
      runner = ->(*command, chdir:) do
        raise IOError, "unexpected build failure in #{chdir}" if command.first == 'gem'

        ''
      end

      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          ComfortableMediaSurferRelease.bump_and_validate!(root:, version: '3.1.8')
        end
      end

      assert_match(%r{Release preflight failed: unexpected build failure}, error.message)
      assert_equal original_contents, File.read(path)
    end
  end

  def test_preflight_build_accepts_an_already_correct_version_file
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')
      built = false
      runner = ->(*command, chdir:) do
        built = command.first == 'gem' && chdir == root
        ''
      end

      ComfortableMediaSurferRelease.stub(:run!, runner) do
        ComfortableMediaSurferRelease.bump_and_validate!(root:, version: '3.1.8')
      end

      assert built
      assert_equal '3.1.8', ComfortableMediaSurferRelease.current_version(root)
    end
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

  def test_rubygems_recovery_also_synchronizes_the_github_release
    calls = []
    tag_checkout = ->(root:, version:, &block) do
      calls << [:tag_checkout, root, version]
      block.call('/tagged-release')
    end
    publisher = ->(root:, version:, dry_run:, allow_existing:) do
      calls << [:rubygems, root, version, dry_run, allow_existing]
      :already_published
    end
    synchronizer = ->(root:, version:, dry_run:, repo:) do
      calls << [:github, root, version, dry_run, repo]
      true
    end

    ComfortableMediaSurferRelease.stub(:verify_clean_worktree!, true) do
      ComfortableMediaSurferRelease.stub(:repository_slug, 'shakacode/comfortable-media-surfer') do
        ComfortableMediaSurferRelease.stub(:verify_gh_auth!, true) do
          ComfortableMediaSurferRelease.stub(:with_tag_checkout, tag_checkout) do
            ComfortableMediaSurferRelease.stub(:publish_to_rubygems!, publisher) do
              ComfortableMediaSurferRelease.stub(:sync_github_release!, synchronizer) do
                result = ComfortableMediaSurferRelease.recover_rubygems_release!(
                  root: '/checkout', version: '3.1.8'
                )

                assert_equal :already_published, result
              end
            end
          end
        end
      end
    end

    assert_equal [
      [:tag_checkout, '/checkout', '3.1.8'],
      [:rubygems, '/tagged-release', '3.1.8', false, true],
      [:github, '/tagged-release', '3.1.8', false, 'shakacode/comfortable-media-surfer']
    ], calls
  end

  def test_rubygems_publication_only_builds_and_pushes_the_existing_version
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')
      command = nil
      runner = ->(*args, chdir:) do
        command = [args, chdir] if args.first == 'bundle'
        true
      end

      ComfortableMediaSurferRelease.stub(:run_interactive!, runner) do
        ComfortableMediaSurferRelease.stub(:rubygems_versions, []) do
          ComfortableMediaSurferRelease.publish_to_rubygems!(root:, version: '3.1.8')
        end
      end

      assert_equal [%w[bundle exec gem release], root], command
    end
  end

  def test_live_github_release_sync_fails_when_release_notes_are_missing
    Dir.mktmpdir do |root|
      write_release_files(root, version: '3.1.8', changelog: '')

      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.sync_github_release!(root:, version: '3.1.8')
      end

      assert_match(%r{cannot sync the GitHub release}, error.message)
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

  def test_release_tags_existing_head_when_version_is_already_checked_in
    commands = []
    runner = ->(*command, chdir:) do
      commands << [command, chdir]
      return 'release-head' if command == %w[git rev-parse HEAD]

      ''
    end

    ComfortableMediaSurferRelease.stub(:run!, runner) do
      ComfortableMediaSurferRelease.stub(:publish_to_rubygems!, :published) do
        ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
      end
    end

    refute(commands.any? { |command, _root| command.first(2) == %w[git commit] })
    assert_includes commands, [['git', 'tag', '-a', 'v3.2.0', '-m', 'Release v3.2.0'], '/release']
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

  def test_remote_release_state_uses_atomic_branch_update_as_publication_proof
    status = Struct.new(:success?).new(true)
    complete = <<~OUTPUT
      release-head\trefs/heads/master
      tag-object\trefs/tags/v3.2.0
      release-head\trefs/tags/v3.2.0^{}
    OUTPUT
    partial = "release-head\trefs/heads/master\n"

    Open3.stub(:capture3, [complete, "SSH warning\n", status]) do
      assert_equal :published,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release', release_head: 'release-head', tag: 'v3.2.0'
                   )
    end
    Open3.stub(:capture3, [partial, '', status]) do
      assert_equal :published,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release', release_head: 'release-head', tag: 'v3.2.0'
                   )
    end

    Open3.stub(:capture3, [partial, '', status]) do
      assert_equal :not_published,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release',
                     release_head: 'release-head',
                     tag: 'v3.2.0',
                     branch_already_matched: true
                   )
    end
  end

  def test_remote_release_state_ignores_non_ref_stdout_lines
    status = Struct.new(:success?).new(true)
    output = <<~OUTPUT
      advice: checking remote state
      release-head\trefs/heads/master
      malformed line with extra fields
    OUTPUT

    Open3.stub(:capture3, [output, '', status]) do
      assert_equal :not_published,
                   ComfortableMediaSurferRelease.remote_release_state(
                     root: '/release',
                     release_head: 'release-head',
                     tag: 'v3.2.0',
                     branch_already_matched: true
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

  def test_definitive_push_rejection_reports_the_original_failure_without_rollback_state
    runner = ->(*command, chdir:) do
      return 'release-head' if command == %w[git rev-parse HEAD]
      raise ComfortableMediaSurferRelease::ReleaseError, "atomic push rejected in #{chdir}" if command.include?('push')

      ''
    end

    error = ComfortableMediaSurferRelease.stub(:run!, runner) do
      ComfortableMediaSurferRelease.stub(:remote_release_state, :not_published) do
        assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
          ComfortableMediaSurferRelease.publish_release!(root: '/release', version: '3.2.0')
        end
      end
    end

    assert_match(%r{atomic push rejected}, error.message)
    refute_match(%r{Unable to prove whether}, error.message)
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
      push_attempted = false
      runner = ->(*command, chdir:) do
        if command == %w[git push --atomic origin master v3.1.8]
          push_attempted = true
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

      assert push_attempted, 'expected the fixture to reach the simulated atomic push failure'
      assert_equal original_head, run_git(checkout, 'rev-parse', 'HEAD').strip
      assert_equal original_contents, File.read(File.join(checkout, 'lib/comfortable_media_surfer/version.rb'))
      assert_empty run_git(checkout, 'tag', '--list', 'v3.1.8').strip
      assert_empty run_git(checkout, 'status', '--porcelain').strip
    end
  end

  def test_failure_before_push_rolls_back_without_probing_remote_refs
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)
      original_head = run_git(checkout, 'rev-parse', 'HEAD').strip
      original_contents = File.read(File.join(checkout, 'lib/comfortable_media_surfer/version.rb'))
      ComfortableMediaSurferRelease.bump_and_validate!(root: checkout, version: '3.1.8')

      original_run = ComfortableMediaSurferRelease.method(:run!)
      runner = ->(*command, chdir:) do
        if command.first(2) == %w[git commit]
          raise ComfortableMediaSurferRelease::ReleaseError, 'simulated commit-hook failure'
        end

        original_run.call(*command, chdir:)
      end
      remote_probe = ->(**) { flunk 'pre-push failures must not query remote release state' }

      assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          ComfortableMediaSurferRelease.stub(:remote_release_state, remote_probe) do
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

  def test_live_release_rejects_a_local_master_that_does_not_match_origin
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)
      File.write(File.join(checkout, 'local-only.txt'), "local only\n")
      run_git(checkout, 'add', 'local-only.txt')
      run_git(checkout, '-c', 'user.name=Release Test', '-c', 'user.email=release@example.com',
              'commit', '-m', 'Local-only commit')

      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.prepare_live_checkout!(checkout)
      end

      assert_match(%r{must exactly match origin/master}, error.message)
    end
  end

  def test_successful_dry_run_is_not_failed_by_worktree_cleanup_errors
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)
      original_run = ComfortableMediaSurferRelease.method(:run!)
      runner = ->(*command, chdir:) do
        if command.first(4) == %w[git worktree remove --force]
          raise ComfortableMediaSurferRelease::ReleaseError, 'simulated cleanup failure'
        end

        original_run.call(*command, chdir:)
      end

      result = nil
      _output, warnings = capture_io do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          result = ComfortableMediaSurferRelease.with_release_checkout(root: checkout, dry_run: true) { :success }
        end
      end

      assert_equal :success, result
      assert_match(%r{simulated cleanup failure}, warnings)
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

  def test_tag_checkout_reports_a_missing_release_tag_cleanly
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)

      error = assert_raises(ComfortableMediaSurferRelease::ReleaseError) do
        ComfortableMediaSurferRelease.with_tag_checkout(root: checkout, version: '9.9.9') { flunk 'must not yield' }
      end

      assert_match(%r{Release tag v9\.9\.9 does not exist}, error.message)
      assert_empty run_git(checkout, 'status', '--porcelain').strip
    end
  end

  def test_successful_tag_recovery_is_not_failed_by_worktree_cleanup_errors
    Dir.mktmpdir do |sandbox|
      _origin, _seed, checkout = create_git_release_fixture(sandbox)
      original_run = ComfortableMediaSurferRelease.method(:run!)
      runner = ->(*command, chdir:) do
        if command.first(4) == %w[git worktree remove --force]
          raise ComfortableMediaSurferRelease::ReleaseError, 'simulated tag cleanup failure'
        end

        original_run.call(*command, chdir:)
      end

      result = nil
      _output, warnings = capture_io do
        ComfortableMediaSurferRelease.stub(:run!, runner) do
          result = ComfortableMediaSurferRelease.with_tag_checkout(root: checkout, version: '3.1.7') { :success }
        end
      end

      assert_equal :success, result
      assert_match(%r{simulated tag cleanup failure}, warnings)
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
    run_git(checkout, 'config', 'user.name', 'Release Test')
    run_git(checkout, 'config', 'user.email', 'release@example.com')
    run_git(checkout, 'config', 'commit.gpgsign', 'false')
    [origin, seed, checkout]
  end

  def run_git(directory, *)
    output, status = Open3.capture2e('git', *, chdir: directory)
    raise output unless status.success?

    output
  end
end
