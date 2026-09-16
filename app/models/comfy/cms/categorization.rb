# frozen_string_literal: true

class Comfy::Cms::Categorization < ActiveRecord::Base
  self.table_name = 'comfy_cms_categorizations'

  # -- Relationships -----------------------------------------------------------
  belongs_to :category
  belongs_to :categorized,
             polymorphic: true

  # -- Validations -------------------------------------------------------------
  validates :category_id,
            uniqueness: { scope: %i[categorized_type categorized_id] }
  validate :category_belongs_to_site

private

  def category_belongs_to_site
    return unless category && categorized.respond_to?(:site_id)

    errors.add(:category_id, :invalid) if category.site_id != categorized.site_id
  end
end
