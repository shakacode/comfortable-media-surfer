# frozen_string_literal: true

require 'comfortable_media_surfer'
require 'rails'
require 'rails-i18n'
require 'comfy_bootstrap_form'
require 'active_link_to'
require 'kramdown'
require 'jquery-rails'
require 'haml-rails'

module ComfortableMediaSurfer
  class Engine < ::Rails::Engine
    config.to_prepare do
      Dir.glob("#{Rails.root}app/decorators/comfortable_media_surfer/*_decorator*.rb").each do |c|
        require_dependency(c)
      end
    end
  end
end
