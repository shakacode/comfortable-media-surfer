# frozen_string_literal: true

# Evaluates arbitrary ERB in CMS layouts, pages, and snippets.
#
# Usage:
#   {{ cms:erb "<%= Time.now.year %>" }}
#
# SECURITY: Only enable when CMS editors are fully trusted.

class ComfortableMediaSurfer::Content::Tag::Erb < ComfortableMediaSurfer::Content::Tag
  def initialize(context:, params: [], source: '')
    super
    @erb_code = params[0].to_s.strip
  end

  # Tell the renderer this tag's output contains ERB that should not be escaped
  def allow_erb
    true
  end

  def content
    @erb_code
  end
end

ComfortableMediaSurfer::Content::Renderer.register_tag(
  :erb, ComfortableMediaSurfer::Content::Tag::Erb
)
