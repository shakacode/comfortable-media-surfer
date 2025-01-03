# frozen_string_literal: true

require_relative '../../test_helper'

class ContentTagTest < ActiveSupport::TestCase
  class TestTag < ComfortableMediaSurfer::Content::Tag
    def content
      'test tag content'
    end
  end

  class TestNestedTag < ComfortableMediaSurfer::Content::Tag
    def content
      'test {{cms:test}} content'
    end
  end

  setup do
    ComfortableMediaSurfer::Content::Renderer.register_tag(:test, TestTag)
    ComfortableMediaSurfer::Content::Renderer.register_tag(:test_nested, TestNestedTag)
  end

  teardown do
    ComfortableMediaSurfer::Content::Renderer.tags.delete('test')
    ComfortableMediaSurfer::Content::Renderer.tags.delete('test_nested')
  end

  # -- Tests -------------------------------------------------------------------

  def test_init
    tag = TestTag.new(
      context: comfy_cms_pages(:default),
      params: ['param_a', { 'key' => 'value' }],
      source: 'source'
    )
    assert_equal comfy_cms_pages(:default), tag.context
    assert_equal ['param_a', { 'key' => 'value' }], tag.params
    assert_equal 'source', tag.source
  end

  def test_nodes
    tag = TestTag.new(context: nil, params: [], source: '')
    assert_equal ['test tag content'], tag.nodes
  end

  def test_tag_nodes_with_nested_tag
    tag = TestNestedTag.new(context: nil, params: [], source: '')
    nodes = tag.nodes
    assert_equal 3, nodes.count
    assert_equal 'test ', nodes[0]
    assert nodes[1].is_a?(ContentTagTest::TestTag)
    assert_equal ' content', nodes[2]
  end

  def test_content_on_base_class
    tag = ComfortableMediaSurfer::Content::Tag.new(context: nil)
    assert_raise ComfortableMediaSurfer::Content::Tag::Error do
      tag.content
    end
  end
end
