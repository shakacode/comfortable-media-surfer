# frozen_string_literal: true

require 'English'
require 'fileutils'
require 'json'
require 'open3'
require 'rubygems/version'
require 'securerandom'
require 'shellwords'
require 'tempfile'
require 'tmpdir'

# The release flow intentionally lives together so the irreversible ordering is auditable.
module ComfortableMediaSurferRelease
  class ReleaseError < StandardError; end

  DEFAULT_BRANCH = 'master'
  CANONICAL_REPOSITORY = 'shakacode/comfortable-media-surfer'
  REQUIRED_PUSH_WORKFLOWS = ['Rails CI', 'Coveralls'].freeze
  VERSION_PATTERN = %r{\A\d+\.\d+\.\d+(?:\.(?:beta|rc)\.\d+)?\z}
  GITHUB_REPO_PATTERN = %r{\A[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\z}

module_function

  def run!(*command, chdir:)
    stdout, stderr, status = Open3.capture3(*command, chdir:)
    return stdout if status.success?

    detail = [stdout, stderr].reject(&:empty?).join("\n").strip
    raise ReleaseError, "Command failed: #{Shellwords.join(command)}#{"\n\n#{detail}" unless detail.empty?}"
  rescue Errno::ENOENT => e
    raise ReleaseError, "Command not found: #{e.message}"
  end

  def run_interactive!(*command, chdir:)
    result = system(*command, chdir:)
    return true if result

    if result.nil?
      raise ReleaseError, "Command not found: #{Shellwords.join(command)}"
    end

    raise ReleaseError, "Command failed: #{Shellwords.join(command)}"
  end

  def truthy?(value)
    %w[1 true yes t].include?(value.to_s.downcase)
  end

  def read_required_file(path)
    File.read(path, encoding: 'UTF-8')
  rescue Errno::ENOENT
    raise ReleaseError, "Required release file is missing: #{path}"
  end

  def current_version(root)
    path = File.join(root, 'lib', 'comfortable_media_surfer', 'version.rb')
    match = read_required_file(path).match(%r{VERSION\s*=\s*['"]([^'"]+)['"]})
    raise ReleaseError, "Unable to read the gem version from #{path}" unless match

    match[1]
  end

  def validate_requested_version!(version)
    return if version.match?(VERSION_PATTERN)

    raise ReleaseError,
          "Version must use RubyGems format, such as 3.2.0 or 3.2.0.rc.0; got #{version.inspect}."
  end

  def extract_latest_changelog_version(root)
    path = File.join(root, 'CHANGELOG.md')
    read_required_file(path).each_line do |line|
      match = line.match(%r{^## \[v?(\d+\.\d+\.\d+(?:[-.](?:beta|rc)\.\d+)?)\]})
      return match[1].sub(%r{-(beta|rc)\.}, '.\\1.') if match
    end
    nil
  end

  def resolve_version(root:, requested:)
    requested = requested.to_s.strip
    unless requested.empty?
      validate_requested_version!(requested)
      return requested
    end

    current = current_version(root)
    changelog = extract_latest_changelog_version(root)
    return changelog if changelog && Gem::Version.new(changelog) > Gem::Version.new(current)

    unless current.match?(%r{\A\d+\.\d+\.\d+\z})
      raise ReleaseError,
            "Automatic patch bumps require a stable major.minor.patch current version; current version is #{current}. " \
            'Pass the intended final or prerelease version explicitly.'
    end

    segments = Gem::Version.new(current).segments
    segments[2] += 1
    segments.join('.')
  end

  def tagged_versions(root, fetch: true)
    run!('git', 'fetch', '--tags', '--quiet', chdir: root) if fetch
    run!('git', 'tag', '-l', 'v*', chdir: root).lines.filter_map do |line|
      version = line.strip.delete_prefix('v')
      version if version.match?(VERSION_PATTERN)
    end
  end

  def validate_version_policy!(target:, tagged_versions:, changelog_section: nil, current: nil)
    validate_requested_version!(target)
    if current && Gem::Version.new(target) < Gem::Version.new(current)
      raise ReleaseError, "Requested version #{target} must not be older than checked-in version #{current}."
    end

    latest = tagged_versions.max_by { |version| Gem::Version.new(version) }
    if latest && Gem::Version.new(target) <= Gem::Version.new(latest)
      raise ReleaseError, "Requested version #{target} must be greater than latest tagged version #{latest}."
    end

    latest_stable = tagged_versions.grep_v(%r{\.(?:beta|rc)\.})
      .max_by { |version| Gem::Version.new(version) }
    return true unless latest_stable && changelog_section && !target.match?(%r{\.(?:beta|rc)\.})

    expected = expected_bump_type(changelog_section)
    actual = version_bump_type(previous: latest_stable, target:)
    return true unless expected && actual != expected

    raise ReleaseError, "CHANGELOG.md requires a #{expected} bump, but #{target} is a #{actual} bump."
  end

  def version_bump_type(previous:, target:)
    old = Gem::Version.new(previous).segments.first(3)
    new = Gem::Version.new(target).segments.first(3)
    return :major if new[0] > old[0]
    return :minor if new[1] > old[1]

    :patch
  end

  def expected_bump_type(section)
    return :major if section.match?(%r{^###\s+(?:⚠️\s*)?Breaking(?:\s+Changes?)?\b}i)
    return :major if section.match?(%r{^###\s+Removed\b}i)
    return :minor if section.match?(%r{^###\s+(Added|New\s+Features?|Features?|Enhancements?)\b}i)
    return :patch if section.match?(%r{^###\s+(Fixed|Fixes|Bug\s+Fixes?|Security|Deprecated)\b}i)

    nil
  end

  def extract_changelog_section(changelog:, version:)
    changelog_version = version.sub(%r{\.(beta|rc)\.}, '-\\1.')
    header = %r{^## \[v?(?:#{Regexp.escape(version)}|#{Regexp.escape(changelog_version)})\](?:\s+-\s+.*)?$}
    following_header = %r{^## \[}
    collecting = false
    lines = []

    changelog.each_line do |line|
      if collecting
        break if line.match?(following_header)

        lines << line
      elsif line.chomp.match?(header)
        collecting = true
      end
    end

    section = lines.join.strip
    section unless section.empty?
  end

  def changelog_section(root:, version:)
    changelog = read_required_file(File.join(root, 'CHANGELOG.md'))
    extract_changelog_section(changelog:, version:)
  end

  def validate_changelog_presence!(notes:, version:, dry_run:)
    return true if notes

    message = "No CHANGELOG.md section found for v#{version}."
    if dry_run
      warn "⚠️ DRY RUN: #{message}"
      return false
    end

    raise ReleaseError, "#{message} Add release notes before publishing."
  end

  def github_repo_slug(origin_url)
    match = origin_url.strip.match(%r{\Agit@github\.com:(?<repo>[^/]+/[^/]+?)(?:\.git)?\z}) ||
            origin_url.strip.match(%r{\Ahttps://(?:[^/@]+@)?github\.com/(?<repo>[^/]+/[^/]+?)(?:\.git)?\z}) ||
            origin_url.strip.match(%r{\Assh://git@github\.com(?::\d+)?/(?<repo>[^/]+/[^/]+?)(?:\.git)?\z})
    repo = match && match[:repo]
    raise ReleaseError, "Unable to determine a GitHub repository from #{origin_url.inspect}." unless repo&.match?(GITHUB_REPO_PATTERN)

    repo
  end

  def repository_slug(root)
    fetch_repo = github_repo_slug(run!('git', 'remote', 'get-url', 'origin', chdir: root))
    push_urls = run!('git', 'remote', 'get-url', '--push', '--all', 'origin', chdir: root).lines.map(&:strip).reject(&:empty?)
    unless push_urls.one?
      raise ReleaseError, "Origin must have exactly one push URL before releasing; found #{push_urls.length}."
    end

    push_repo = github_repo_slug(push_urls.first)
    unless fetch_repo == push_repo
      raise ReleaseError,
            "Origin fetch repository #{fetch_repo} does not match push repository #{push_repo}; refusing to release."
    end
    unless fetch_repo == CANONICAL_REPOSITORY
      raise ReleaseError,
            "Releases must run from #{CANONICAL_REPOSITORY}; origin points to #{fetch_repo}."
    end

    fetch_repo
  end

  def verify_clean_worktree!(root)
    return if run!('git', 'status', '--porcelain', chdir: root).strip.empty?

    raise ReleaseError, 'Uncommitted changes found. Commit or stash them before releasing.'
  end

  def verify_release_branch!(root)
    branch = run!('git', 'branch', '--show-current', chdir: root).strip
    return if branch == DEFAULT_BRANCH

    raise ReleaseError, "Releases must run from #{DEFAULT_BRANCH}; current branch is #{branch.empty? ? 'detached' : branch}."
  end

  def verify_gh_auth!(root, repo: nil)
    _output, status = Open3.capture2e('gh', 'auth', 'status', '--active', '--hostname', 'github.com', chdir: root)
    raise ReleaseError, 'GitHub CLI authentication required. Run `gh auth login` and retry.' unless status.success?

    repo ||= repository_slug(root)
    output, _errors, permission_status = Open3.capture3(
      'gh', 'api', "repos/#{repo}", '--jq', '.permissions.push', chdir: root
    )
    unless permission_status.success? && output.strip == 'true'
      raise ReleaseError, "GitHub CLI does not have verified write access to #{repo}."
    end
  rescue Errno::ENOENT
    raise ReleaseError, 'GitHub CLI is not installed or is not available on PATH.'
  end

  def latest_runs_by_name(runs)
    runs.group_by { |run| run.fetch('name') }.transform_values do |group|
      group.max_by { |run| run.fetch('created_at', '') }
    end
  end

  def validate_ci_runs!(runs:)
    latest = latest_runs_by_name(runs)
    problems = REQUIRED_PUSH_WORKFLOWS.filter_map do |workflow|
      run = latest[workflow]
      next "#{workflow} (missing)" unless run
      next if run['status'] == 'completed' && run['conclusion'] == 'success'

      state = run['status'] == 'completed' ? run['conclusion'] : run['status']
      "#{workflow} (#{state || 'unknown'})"
    end
    return true if problems.empty?

    raise ReleaseError, "Release CI is not green: #{problems.join(', ')}."
  end

  def workflow_runs(root:, commit_sha:, repo: nil)
    repo ||= repository_slug(root)
    endpoint = "repos/#{repo}/actions/runs?head_sha=#{commit_sha}&branch=#{DEFAULT_BRANCH}&event=push&per_page=100"
    output = run!('gh', 'api', '--paginate', '--slurp', endpoint, chdir: root)
    pages = JSON.parse(output)
    valid_pages = pages.is_a?(Array) && pages.all? do |page|
      page.is_a?(Hash) && page['workflow_runs'].is_a?(Array) && page['workflow_runs'].all? do |run|
        run.is_a?(Hash) && run['name'].is_a?(String) && !run['name'].empty?
      end
    end
    raise ReleaseError, 'GitHub workflow response did not contain valid pages.' unless valid_pages

    pages.flat_map { |page| page.fetch('workflow_runs') }
  rescue JSON::ParserError => e
    raise ReleaseError, "Unable to parse GitHub workflow data: #{e.message}"
  end

  def validate_release_ci!(root:, override:, dry_run:, repo: nil)
    sha = run!('git', 'rev-parse', 'HEAD', chdir: root).strip
    validate_ci_runs!(runs: workflow_runs(root:, commit_sha: sha, repo:))
    puts "✓ Required push workflows passed for #{sha[0, 12]}"
    :passed
  rescue ReleaseError => e
    if override
      warn "⚠️ RELEASE_CI_STATUS_OVERRIDE enabled: #{e.message}"
      :overridden
    elsif dry_run
      warn "⚠️ DRY RUN: #{e.message}"
      :dry_run_warning
    else
      raise
    end
  end

  def prepare_live_checkout!(root)
    verify_release_branch!(root)
    run!('git', 'fetch', 'origin', DEFAULT_BRANCH, '--tags', chdir: root)
    local_head = run!('git', 'rev-parse', 'HEAD', chdir: root).strip
    remote_head = run!('git', 'rev-parse', "origin/#{DEFAULT_BRANCH}", chdir: root).strip
    return true if local_head == remote_head

    raise ReleaseError,
          "Local #{DEFAULT_BRANCH} must exactly match origin/#{DEFAULT_BRANCH} before releasing. " \
          'Push, reset, or reconcile the branch first.'
  end

  def with_release_checkout(root:, dry_run:)
    return yield(root) unless dry_run

    Dir.mktmpdir('comfortable-media-surfer-release-') do |temporary_root|
      directory = File.join(temporary_root, 'worktree')
      branch = "release-dry-run-#{Process.pid}-#{SecureRandom.hex(4)}"
      begin
        run!('git', 'fetch', 'origin', DEFAULT_BRANCH, '--tags', chdir: root)
        run!('git', 'worktree', 'prune', chdir: root)
        run!('git', 'worktree', 'add', '-b', branch, directory, "origin/#{DEFAULT_BRANCH}", chdir: root)
        run!('git', 'branch', '--set-upstream-to', "origin/#{DEFAULT_BRANCH}", branch, chdir: directory)
        yield(directory)
      ensure
        remove_worktree_safely!(root:, directory:)
        begin
          run!('git', 'branch', '-D', branch, chdir: root)
        rescue ReleaseError => e
          warn "⚠️ #{e.message}"
        end
      end
    end
  end

  def with_tag_checkout(root:, version:)
    tag = "v#{version}"
    Dir.mktmpdir('comfortable-media-surfer-tag-') do |temporary_root|
      directory = File.join(temporary_root, 'worktree')
      begin
        run!('git', 'fetch', 'origin', '--tags', '--quiet', chdir: root)
        _output, status = Open3.capture2e('git', 'rev-parse', '--verify', '--quiet', "refs/tags/#{tag}", chdir: root)
        unless status.success?
          raise ReleaseError, "Release tag #{tag} does not exist locally or on origin. Check the recovery version."
        end

        run!('git', 'worktree', 'add', '--detach', directory, tag, chdir: root)
        verify_release_tag_at_head!(root: directory, version:)
        yield(directory)
      ensure
        remove_worktree_safely!(root:, directory:)
      end
    end
  end

  def remove_worktree_safely!(root:, directory:)
    return unless File.exist?(directory)

    run!('git', 'worktree', 'remove', '--force', directory, chdir: root)
  rescue ReleaseError => e
    warn "⚠️ #{e.message}"
    FileUtils.rm_rf(directory)
    begin
      run!('git', 'worktree', 'prune', chdir: root)
    rescue ReleaseError => prune_error
      warn "⚠️ #{prune_error.message}"
    end
  end

  def confirm!(prompt)
    return if truthy?(ENV.fetch('RELEASE_AUTO_CONFIRM', nil))

    print "#{prompt} [y/N]: "
    answer = $stdin.gets.to_s.strip.downcase
    raise ReleaseError, 'Aborted by user.' unless %w[y yes].include?(answer)
  end

  def release_confirmation_prompt(version:, ci_state:)
    prompt = "Release comfortable_media_surfer #{version}?"
    return prompt unless ci_state == :overridden

    "CI IS NOT GREEN — RELEASE_CI_STATUS_OVERRIDE is active. #{prompt}"
  end

  def bump_and_validate!(root:, version:)
    path = File.join(root, 'lib', 'comfortable_media_surfer', 'version.rb')
    contents = read_required_file(path)
    version_match = contents.match(%r{VERSION\s*=\s*['"]([^'"]+)['"]})
    raise ReleaseError, "Unable to update the gem version in #{path}." unless version_match

    updated = if version_match[1] == version
                contents
              else
                contents.sub(%r{(VERSION\s*=\s*['"])[^'"]+(['"])}, "\\1#{version}\\2")
              end

    begin
      File.write(path, updated, encoding: 'UTF-8')
      actual = current_version(root)
      raise ReleaseError, "Expected gem bump to produce #{version}, but found #{actual}." unless actual == version

      run!('gem', 'build', 'comfortable_media_surfer.gemspec', chdir: root)
    rescue StandardError => e
      begin
        File.write(path, contents, encoding: 'UTF-8') unless File.read(path, encoding: 'UTF-8') == contents
      rescue StandardError => restore_error
        raise ReleaseError,
              "Release preflight failed (#{e.message}) and the original version file could not be restored: " \
              "#{restore_error.message}"
      end
      raise e if e.is_a?(ReleaseError)

      raise ReleaseError, "Release preflight failed: #{e.message}"
    ensure
      FileUtils.rm_f(File.join(root, "comfortable_media_surfer-#{version}.gem"))
    end
  end

  def rubygems_versions(root:)
    output = run!('gem', 'list', '--remote', '--exact', 'comfortable_media_surfer', '--all', '--prerelease', chdir: root)
    versions = output.match(%r{^\s*comfortable_media_surfer \((?<versions>[^)]+)\)\s*$})
    unless versions
      raise ReleaseError, 'RubyGems response did not include comfortable_media_surfer versions; refusing to publish.'
    end

    versions[:versions].split(',').map(&:strip)
  end

  def publish_to_rubygems!(root:, version:, dry_run: false, allow_existing: false)
    actual = current_version(root)
    unless actual == version
      raise ReleaseError, "Version file contains #{actual}, not the requested RubyGems version #{version}."
    end

    if dry_run
      puts "DRY RUN: comfortable_media_surfer #{version} would be published to RubyGems."
      return :dry_run
    end

    if rubygems_versions(root:).include?(version)
      if allow_existing
        puts "✓ comfortable_media_surfer #{version} is already published to RubyGems."
        return :already_published
      end

      raise ReleaseError,
            "comfortable_media_surfer #{version} already exists on RubyGems. " \
            'Refusing to create repository metadata for a potentially different artifact.'
    end

    puts 'Use the OTP for RubyGems when prompted.'
    run_interactive!('bundle', 'exec', 'gem', 'release', chdir: root)
    :published
  end

  def verify_release_tag_at_head!(root:, version:)
    tag = "v#{version}"
    head = run!('git', 'rev-parse', 'HEAD', chdir: root).strip
    local_tag = run!('git', 'rev-list', '-n', '1', tag, chdir: root).strip
    raise ReleaseError, "Local tag #{tag} does not point at HEAD." unless local_tag == head

    remote_tags = run!('git', 'ls-remote', '--tags', 'origin', "refs/tags/#{tag}", "refs/tags/#{tag}^{}", chdir: root)
    return true if remote_tags.lines.any? { |line| line.split.first == head }

    raise ReleaseError, "Remote tag #{tag} does not point at HEAD. Refusing RubyGems recovery."
  end

  def rollback_failed_git_release!(root:, original_head:, original_version_contents:, tag:)
    tag_ref = "refs/tags/#{tag}"
    _output, tag_status = Open3.capture2e('git', 'rev-parse', '--quiet', '--verify', tag_ref, chdir: root)
    run!('git', 'tag', '-d', tag, chdir: root) if tag_status.success?

    head = run!('git', 'rev-parse', 'HEAD', chdir: root).strip
    if head == original_head
      run!('git', 'reset', 'HEAD', '--', 'lib/comfortable_media_surfer/version.rb', chdir: root)
    else
      run!('git', 'reset', '--mixed', original_head, chdir: root)
    end
    File.write(
      File.join(root, 'lib', 'comfortable_media_surfer', 'version.rb'),
      original_version_contents,
      encoding: 'UTF-8'
    )
  end

  def parse_git_refs(output)
    output.lines.filter_map do |line|
      sha, ref = line.split
      [ref, sha] if sha && ref&.start_with?('refs/')
    end.to_h
  end

  def remote_release_state(root:, release_head:, tag:, branch_already_matched: false)
    output, _errors, status = Open3.capture3(
      'git', 'ls-remote', 'origin', "refs/heads/#{DEFAULT_BRANCH}", "refs/tags/#{tag}", "refs/tags/#{tag}^{}",
      chdir: root
    )
    return :unknown unless status.success?

    refs = parse_git_refs(output)
    branch_matches = refs["refs/heads/#{DEFAULT_BRANCH}"] == release_head
    tag_matches = [refs["refs/tags/#{tag}"], refs["refs/tags/#{tag}^{}"]].include?(release_head)
    return :published if branch_matches && tag_matches
    return :published if branch_matches && !branch_already_matched
    return :not_published if branch_already_matched && branch_matches && !tag_matches
    return :not_published unless branch_matches || tag_matches

    :unknown
  rescue Errno::ENOENT
    :unknown
  end

  def rollback_release_if_possible!(root:, original_head:, original_version_contents:, tag:)
    return unless original_version_contents

    rollback_failed_git_release!(root:, original_head:, original_version_contents:, tag:)
  rescue ReleaseError => e
    warn "⚠️ Automatic local rollback also failed: #{e.message}"
  end

  def publish_release!(root:, version:, original_version_contents: nil)
    tag = "v#{version}"
    original_head = run!('git', 'rev-parse', 'HEAD', chdir: root).strip if original_version_contents
    push_attempted = false
    release_commit_created = false
    begin
      run!('git', 'add', 'lib/comfortable_media_surfer/version.rb', chdir: root)
      staged_files = run!('git', 'diff', '--cached', '--name-only', chdir: root).lines.map(&:strip).reject(&:empty?)
      if staged_files.empty?
        puts "✓ Version #{version} is already checked in; tagging the existing HEAD."
      else
        run!('git', 'commit', '-m', "Release #{tag}", chdir: root)
        release_commit_created = true
      end
      run!('git', 'tag', '-a', tag, '-m', "Release #{tag}", chdir: root)
      push_attempted = true
      run!('git', 'push', '--atomic', 'origin', DEFAULT_BRANCH, tag, chdir: root)
    rescue ReleaseError => e
      unless push_attempted
        rollback_release_if_possible!(root:, original_head:, original_version_contents:, tag:)
        raise e
      end

      release_head = run!('git', 'rev-parse', 'HEAD', chdir: root).strip
      remote_state = remote_release_state(
        root:,
        release_head:,
        tag:,
        branch_already_matched: !release_commit_created
      )
      if remote_state == :published
        warn "⚠️ The push reported a failure, but remote state proves the atomic #{DEFAULT_BRANCH} and #{tag} " \
             "update reached GitHub at #{release_head[0, 12]}; continuing with publication."
      elsif remote_state == :not_published
        rollback_release_if_possible!(root:, original_head:, original_version_contents:, tag:)
        raise e
      else
        raise ReleaseError,
              "#{e.message}\nUnable to prove whether the atomic push reached GitHub. " \
              "The local release commit and tag were preserved; verify remote #{DEFAULT_BRANCH} and #{tag} before continuing."
      end
    end

    begin
      verify_clean_worktree!(root)
      publish_to_rubygems!(root:, version:)
    rescue ReleaseError => e
      warn "PARTIAL RELEASE: commit and tag #{tag} were pushed, but RubyGems publication did not complete."
      warn "Recover safely with: bundle exec rake \"publish_rubygems[#{version}]\""
      raise e
    end
  end

  def prerelease?(version)
    version.match?(%r{\.(?:beta|rc)\.})
  end

  def github_release_command(tag:, repo:, notes_file:, prerelease:, exists:)
    if exists
      return ['gh', 'release', 'edit', tag, '--repo', repo, '--title', tag, '--notes-file', notes_file,
              "--prerelease=#{prerelease}", '--draft=false']
    end

    command = ['gh', 'release', 'create', tag, '--repo', repo, '--verify-tag', '--title', tag,
               '--notes-file', notes_file]
    command << '--prerelease' if prerelease
    command
  end

  def github_release_exists?(root:, repo:, tag:)
    output, status = Open3.capture2e('gh', 'api', "repos/#{repo}/releases/tags/#{tag}", '--silent', chdir: root)
    return true if status.success?
    return false if output.match?(%r{\bHTTP 404\b})

    detail = output.strip
    raise ReleaseError,
          "Unable to check whether GitHub release #{tag} exists#{": #{detail}" unless detail.empty?}."
  rescue Errno::ENOENT => e
    raise ReleaseError, "GitHub CLI is unavailable while checking release #{tag}: #{e.message}"
  end

  def sync_github_release!(root:, version:, dry_run: false, repo: nil)
    notes = changelog_section(root:, version:)
    unless notes
      message = "No CHANGELOG.md section found for v#{version}; cannot sync the GitHub release."
      raise ReleaseError, message unless dry_run

      warn "⚠️ DRY RUN: #{message}"
      return false
    end

    actual = current_version(root)
    unless actual == version
      raise ReleaseError, "Version file contains #{actual}, not the requested GitHub release version #{version}."
    end

    tag = "v#{version}"
    if dry_run
      puts "DRY RUN: GitHub release #{tag} would use the matching CHANGELOG.md section."
      return true
    end

    repo ||= repository_slug(root)
    Tempfile.create(['comfortable-media-surfer-release-', '.md']) do |file|
      file.write(notes)
      file.flush
      command = github_release_command(
        tag:,
        repo:,
        notes_file: file.path,
        prerelease: prerelease?(version),
        exists: github_release_exists?(root:, repo:, tag:)
      )
      run!(*command, chdir: root)
    end
    true
  end

  def recover_rubygems_release!(root:, version:, dry_run: false)
    verify_clean_worktree!(root)
    repo = repository_slug(root)

    with_tag_checkout(root:, version:) do |release_root|
      result = publish_to_rubygems!(
        root: release_root,
        version:,
        dry_run:,
        allow_existing: true
      )
      begin
        verify_gh_auth!(root, repo:) unless dry_run
        sync_github_release!(root: release_root, version:, dry_run:, repo:)
      rescue ReleaseError => e
        warn 'PARTIAL RECOVERY: RubyGems publication is complete, but the GitHub release failed.'
        warn "Recover with: bundle exec rake \"sync_github_release[#{version}]\""
        raise e
      end
      result
    end
  end

  def perform(root:, requested_version:, dry_run:, ci_override:)
    verify_clean_worktree!(root)
    repo = repository_slug(root) unless dry_run
    verify_gh_auth!(root, repo:) unless dry_run
    prepare_live_checkout!(root) unless dry_run

    result = nil
    with_release_checkout(root:, dry_run:) do |release_root|
      ci_state = validate_release_ci!(root: release_root, override: ci_override, dry_run:, repo:)
      version = resolve_version(root: release_root, requested: requested_version)
      notes = changelog_section(root: release_root, version:)
      notes_present = validate_changelog_presence!(notes:, version:, dry_run:)
      validate_version_policy!(
        target: version,
        tagged_versions: tagged_versions(release_root, fetch: false),
        changelog_section: notes,
        current: current_version(release_root)
      )

      unless dry_run
        existing_versions = rubygems_versions(root: release_root)
        if existing_versions.include?(version)
          raise ReleaseError,
                "comfortable_media_surfer #{version} already exists on RubyGems. " \
                'Use a new version instead of recreating its tag.'
        end
      end

      confirm!(release_confirmation_prompt(version:, ci_state:)) unless dry_run
      verify_clean_worktree!(release_root)
      version_path = File.join(release_root, 'lib', 'comfortable_media_surfer', 'version.rb')
      original_version_contents = read_required_file(version_path)
      bump_and_validate!(root: release_root, version:)

      if dry_run
        sync_github_release!(root: release_root, version:, dry_run: true, repo:)
        result = { version:, dry_run: true, changelog_section_found: notes_present }
      else
        publish_release!(root: release_root, version:, original_version_contents:)
        begin
          sync_github_release!(root: release_root, version:, repo:)
        rescue ReleaseError => e
          warn "PARTIAL RELEASE: gem and tag v#{version} were published, but the GitHub release failed."
          warn "Recover with: bundle exec rake \"sync_github_release[#{version}]\""
          raise e
        end
        result = { version:, dry_run: false, changelog_section_found: notes_present }
      end
    end
    result
  end

  def print_summary(result)
    label = result.fetch(:dry_run) ? 'DRY RUN COMPLETE' : 'RELEASE COMPLETE'
    puts "\n#{label}: comfortable_media_surfer #{result.fetch(:version)}"
    return if result.fetch(:changelog_section_found)

    puts 'Add a matching CHANGELOG.md section before publishing the GitHub release.'
  end

  def run_release_task(args, root: File.expand_path('..', __dir__))
    result = perform(
      root:,
      requested_version: args[:version],
      dry_run: truthy?(args[:dry_run]),
      ci_override: truthy?(args[:override_ci_status]) || truthy?(ENV.fetch('RELEASE_CI_STATUS_OVERRIDE', nil))
    )
    print_summary(result)
  rescue ReleaseError => e
    abort "❌ #{e.message}"
  end
end

%i[release create_release sync_github_release publish_rubygems].each do |task_name|
  Rake::Task[task_name].clear if Rake::Task.task_defined?(task_name)
end

desc 'Release the gem with version, CI, tag, RubyGems, and GitHub safeguards'
task :release, %i[version dry_run override_ci_status] do |_task, args|
  ComfortableMediaSurferRelease.run_release_task(args)
end

desc 'Backward-compatible name for the guarded release task'
task :create_release, %i[version dry_run override_ci_status] do |_task, args|
  ComfortableMediaSurferRelease.run_release_task(args)
end

desc 'Create or update a GitHub release from CHANGELOG.md for an existing version'
task :sync_github_release, %i[version dry_run] do |_task, args|
  version = args[:version].to_s.strip
  abort '❌ version is required, for example: rake "sync_github_release[3.2.0]"' if version.empty?

  ComfortableMediaSurferRelease.validate_requested_version!(version)
  root = File.expand_path('..', __dir__)
  dry_run = ComfortableMediaSurferRelease.truthy?(args[:dry_run])
  ComfortableMediaSurferRelease.verify_clean_worktree!(root)
  repo = ComfortableMediaSurferRelease.repository_slug(root) unless dry_run
  ComfortableMediaSurferRelease.verify_gh_auth!(root, repo:) unless dry_run
  ComfortableMediaSurferRelease.with_tag_checkout(root:, version:) do |release_root|
    ComfortableMediaSurferRelease.sync_github_release!(root: release_root, version:, dry_run:, repo:)
  end
rescue ComfortableMediaSurferRelease::ReleaseError => e
  abort "❌ #{e.message}"
end

desc 'Retry or verify RubyGems publication for an already-pushed release tag'
task :publish_rubygems, %i[version dry_run] do |_task, args|
  version = args[:version].to_s.strip
  abort '❌ version is required, for example: rake "publish_rubygems[3.2.0]"' if version.empty?

  ComfortableMediaSurferRelease.validate_requested_version!(version)
  root = File.expand_path('..', __dir__)
  dry_run = ComfortableMediaSurferRelease.truthy?(args[:dry_run])
  ComfortableMediaSurferRelease.recover_rubygems_release!(root:, version:, dry_run:)
rescue ComfortableMediaSurferRelease::ReleaseError => e
  abort "❌ #{e.message}"
end
