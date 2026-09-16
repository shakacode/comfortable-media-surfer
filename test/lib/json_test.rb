# frozen_string_literal: true

require_relative '../test_helper'

class JsonTest < ActiveSupport::TestCase
  def test_parse_ignores_encoding_options
    assert_equal({ 'key' => 'value' }, JSON.parse('{"key":"value"}', escape: false))
  end

  def test_parse_preserves_parser_options
    assert_equal({ key: 'value' }, JSON.parse('{"key":"value"}', symbolize_names: true))
  end
end
