# frozen_string_literal: true

require_relative 'config/application'
require 'open3'
require 'parallel_tests/tasks'
require 'rake/testtask'
require 'stringio'

Rails.application.load_tasks

module ComfortableMediaSurferTestOutput
  SUMMARY = %r{(?<assertions>\d+) assertions, (?<errors>\d+) errors, (?<failures>\d+) failures, (?<skips>\d+) skips?, (?<tests>\d+) tests}
  COLORS = { green: 32, yellow: 33, red: 31, cyan: 36 }.freeze

  class Progress
    def initialize(io)
      @io = io
      @line = +''
      @pending = +''
      @awaiting_blank = false
      @expecting_progress = false
      @printing_progress = false
    end

    def feed(chunk)
      chunk.each_char { |character| consume(character) }
      flush
    end

    def finish
      flush
      @io.puts if @printing_progress
    end

  private

    def consume(character)
      return if character == "\r"
      return finish_line if character == "\n"

      if @expecting_progress && character.match?(%r{[.EFS]})
        @printing_progress = true
        @pending << character
      elsif @printing_progress
        flush
        @io.puts
        @printing_progress = false
        @expecting_progress = false
        @line = +character
      else
        @expecting_progress = false if @expecting_progress
        @line << character
      end
    end

    def finish_line
      flush
      if @printing_progress
        @io.puts
        @expecting_progress = false
      elsif @line.start_with?('# Running tests')
        @awaiting_blank = true
      elsif @awaiting_blank && @line.empty?
        @expecting_progress = true
        @awaiting_blank = false
      end
      @line.clear
      @printing_progress = false
    end

    def flush
      return if @pending.empty?

      @io.print ComfortableMediaSurferTestOutput.progress_color(@pending)
      @io.flush
      @pending.clear
    end
  end

module_function

  def capture(env, command)
    output = +''
    errors = +''
    status = nil
    started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    progress = Progress.new($stdout)

    Open3.popen3(env, *command) do |stdin, stdout, stderr, wait_thread|
      stdin.close
      error_reader = Thread.new { stderr.read }
      loop do
        chunk = stdout.readpartial(4096)
        output << chunk
        progress.feed(chunk)
      end
    rescue EOFError
      errors = error_reader.value
      status = wait_thread.value
    ensure
      progress.finish
    end

    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at
    [output, errors, status, elapsed]
  end

  def color(text, name)
    return text unless $stdout.tty? && !ENV.key?('NO_COLOR')

    "\e[#{COLORS.fetch(name)}m#{text}\e[0m"
  end

  def progress_color(text)
    return text unless $stdout.tty? && !ENV.key?('NO_COLOR')

    highlighted = text.gsub('S', "\e[33mS\e[32m")
      .gsub(%r{[EF]}) { |character| "\e[31m#{character}\e[32m" }
    "\e[32m#{highlighted}\e[0m"
  end

  def summary(output)
    counts = output.match(SUMMARY)
    raise 'Could not read the parallel test summary' unless counts

    "#{counts[:tests]} tests, #{counts[:assertions]} assertions, " \
      "#{counts[:failures]} failures, #{counts[:errors]} errors, " \
      "#{counts[:skips]} #{counts[:skips] == '1' ? 'skip' : 'skips'}"
  end

  def run_parallel
    workers = ENV.fetch('PARALLEL_WORKERS', '6')
    skip_coverage = ENV.fetch('SKIP_COV', nil)
    FileUtils.rm_rf('coverage')
    FileUtils.mkdir_p('tmp')
    Rake::Task['parallel:prepare'].invoke(workers)

    env = {
      'PARALLEL_COVERAGE' => skip_coverage ? nil : 'true',
      'RECORD_RUNTIME' => 'true',
      'SKIP_COV' => skip_coverage,
      'NO_COLOR' => '1',
      'TMPDIR' => ENV.fetch('COMFY_TEST_TMPDIR', '/tmp')
    }
    command = [
      'bundle', 'exec', 'parallel_test', 'test',
      '--type', 'test',
      '--exclude-pattern', 'test/system/',
      '-n', workers
    ]

    puts color("Running tests (#{workers} workers)…", :cyan)
    stdout, stderr, status, elapsed = capture(env, command)
    unless status.success?
      $stdout.write(stdout)
      $stderr.write(stderr)
      raise "Parallel tests failed with status #{status.exitstatus}"
    end
    $stderr.write(stderr) unless stderr.empty?
    puts color(summary(stdout), :green)
    puts color(format('Completed in %.1f seconds', elapsed), :cyan)

    report_coverage unless skip_coverage
  end

  def report_coverage
    require 'simplecov'
    SimpleCov.coverage_dir File.expand_path('coverage', __dir__)
    result = SimpleCov::ResultMerger.merged_result
    quietly { SimpleCov::Formatter::HTMLFormatter.new.format(result) }
    coverage = format('Coverage: %<percent>.2f%% (%<covered>d/%<total>d) — coverage/index.html',
                      percent: result.covered_percent, covered: result.covered_lines, total: result.total_lines)
    puts color(coverage, :green)
  end

  def quietly
    previous = $stdout
    $stdout = StringIO.new
    yield
  ensure
    $stdout = previous
  end
end

namespace :test do
  task :prepare_serial do
    FileUtils.rm_rf('coverage')
    ENV['TMPDIR'] = ENV.fetch('COMFY_TEST_TMPDIR', '/tmp')
  end

  desc 'Run tests serially with coverage'
  Rake::TestTask.new(:serial) do |task|
    task.libs << 'test' << 'lib'
    task.test_files = Rake::FileList['test/**/*_test.rb'].exclude('test/system/**/*_test.rb')
    task.warning = false
  end
  Rake::Task['test:serial'].enhance(['test:prepare_serial'])

  desc 'Run tests in isolated processes'
  task(:parallel) { ComfortableMediaSurferTestOutput.run_parallel }
end

Rake::Task[:test].clear

desc 'Run tests in parallel (default: 6 workers)'
task test: 'test:parallel'
