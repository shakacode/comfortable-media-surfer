# frozen_string_literal: true

class Comfy::Admin::Cms::Revisions::PageController < Comfy::Admin::Cms::Revisions::BaseController
  def show
    @current_content = @record.fragments.to_h do |fragment|
      [fragment.identifier, fragment.content]
    end
    @versioned_content = @record.fragments.to_h do |fragment|
      data = @revision.data['fragments_attributes'].detect { |item| item[:identifier] == fragment.identifier }
      [fragment.identifier, data.try(:[], :content)]
    end

    render 'comfy/admin/cms/revisions/show'
  end

private

  def load_record
    @record = @site.pages.find(params[:page_id])
  rescue ActiveRecord::RecordNotFound
    flash[:danger] = I18n.t('comfy.admin.cms.revisions.record_not_found')
    redirect_to comfy_admin_cms_site_pages_path(@site)
  end

  def record_path
    edit_comfy_admin_cms_site_page_path(@site, @record)
  end
end
