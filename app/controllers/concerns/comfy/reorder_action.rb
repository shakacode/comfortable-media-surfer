# frozen_string_literal: true

module Comfy::ReorderAction
  extend ActiveSupport::Concern

  included do
    mattr_accessor :reorder_action_resource
  end

  def reorder
    resource_class = self.class.reorder_action_resource
    site_resources = resource_class.where(site_id: @site.id)
    (params.permit(order: [])[:order] || []).each_with_index do |id, index|
      site_resources.where(id: id).update_all(position: index)
    end
    @site.pages.each(&:save!) if resource_class == ::Comfy::Cms::Page
    head :ok
  end
end
