# frozen_string_literal: true

require_relative '../test_helper'

class RoutingIntergrationTest < ActionDispatch::IntegrationTest
  def teardown
    Rails.application.reload_routes!
  end

  def test_cms_public_prefix
    assert_nil ComfortableMediaSurfer.config.public_cms_path

    Rails.application.routes.draw do
      comfy_route :cms, path: '/custom'
    end

    assert_equal '/custom', ComfortableMediaSurfer.config.public_cms_path
  end
end
