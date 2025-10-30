# frozen_string_literal: true

class Comfy::Cms::Translation < ActiveRecord::Base
  self.table_name = 'comfy_cms_translations'

  include Comfy::Cms::WithFragments

  cms_has_revisions_for :fragments_attributes

  delegate :site, to: :page

  # -- Relationships -----------------------------------------------------------
  # inverse_of keeps translation.page from triggering additional SELECTs when hydrated via page
  belongs_to :page, inverse_of: :translations

  # -- Callbacks ---------------------------------------------------------------
  before_validation :assign_layout

  # -- Scopes ------------------------------------------------------------------
  scope :published, -> { where(is_published: true) }

  # -- Validations -------------------------------------------------------------
  validates :label,
            presence: true

  validates :locale,
            presence: true,
            uniqueness: { scope: :page_id }

  validate :validate_locale

private

  def validate_locale
    return unless page

    errors.add(:locale) if locale == page.site.locale
  end

  def assign_layout
    self.layout ||= page.layout if page.present?
  end
end
