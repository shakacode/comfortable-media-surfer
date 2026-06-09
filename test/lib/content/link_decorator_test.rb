# frozen_string_literal: true

require_relative '../../test_helper'

class ContentLinkDecoratorTest < ActiveSupport::TestCase
  SITE_HOST    = 'www.squaremouth.com'
  CURRENT_PATH = '/providers'
  CTA_CLASS    = 'view-carriers-show-btn-cta'

  def decorate(html, site_host: SITE_HOST, current_path: CURRENT_PATH, cta_class: CTA_CLASS)
    ComfortableMediaSurfer::Content::LinkDecorator.new(
      html, site_host:, current_path:, cta_class:
    ).call
  end

  def test_decorates_external_links
    result = decorate('<a href="https://www.example.com">External</a>')

    assert_includes result, 'target="_blank"'
    assert_includes result, 'rel="noopener nofollow"'
  end

  def test_leaves_internal_links_untouched
    html = %(<a href="https://#{SITE_HOST}/about">Internal</a>)

    assert_equal html, decorate(html)
  end

  def test_leaves_relative_links_untouched
    html = '<a href="/plans">Relative</a>'

    assert_equal html, decorate(html)
  end

  def test_leaves_anchor_and_mailto_links_untouched
    result = decorate('<a href="#x">Jump</a><a href="mailto:a@b.com">Mail</a>')

    refute_includes result, 'target="_blank"'
    refute_includes result, 'rel='
  end

  def test_external_decoration_is_idempotent
    once  = decorate('<a href="https://www.example.com">External</a>')
    twice = decorate(once)

    assert_equal once, twice
  end

  def test_does_not_raise_on_anchor_without_href
    assert_nothing_raised { decorate('<a>No href</a>') }
  end

  def test_appends_so_param_to_cta_links
    result = decorate('<a href="/quote" class="view-carriers-show-btn-cta">Get A Free Quote</a>')

    assert_includes result, 'so='
    assert_includes result, 'get-a-free-quote-1'
    assert_includes result, CGI.escape(CURRENT_PATH)
  end

  def test_does_not_touch_links_without_cta_class
    refute_includes decorate('<a href="/plans">View Plans</a>'), 'so='
  end

  def test_preserves_existing_query_params
    result = decorate('<a href="/quote?carrier=x" class="view-carriers-show-btn-cta">Get Quote</a>')

    assert_includes result, 'carrier=x'
    assert_includes result, 'so='
  end

  def test_indexes_within_the_cta_set_only
    cta    = '<a href="/q" class="view-carriers-show-btn-cta">Get A Free Quote</a>'
    result = decorate(%(<a href="/plain">Plain</a>#{cta}#{cta}))

    assert_includes result, 'get-a-free-quote-1'
    assert_includes result, 'get-a-free-quote-2'
  end

  def test_adds_so_param_exactly_once_per_call
    result = decorate('<a href="/quote" class="view-carriers-show-btn-cta">Get A Free Quote</a>')

    assert_equal 1, result.scan('so=').length
  end

  def test_does_not_raise_on_invalid_uri
    html = '<a href="http://[invalid" class="view-carriers-show-btn-cta">Bad</a>'

    assert_nothing_raised { decorate(html) }
  end

  def test_skips_cta_decoration_when_cta_class_is_blank
    html   = '<a href="/quote" class="view-carriers-show-btn-cta">Get Quote</a>'
    result = decorate(html, cta_class: nil)

    refute_includes result, 'so='
  end

  def test_applies_both_external_and_cta_decoration
    result = decorate('<a href="https://www.example.com/quote" class="view-carriers-show-btn-cta">Get Quote</a>')

    assert_includes result, 'target="_blank"'
    assert_includes result, 'rel="noopener nofollow"'
    assert_includes result, 'so='
  end
end
