# frozen_string_literal: true

# Tag for text content that is going to be rendered using Redactor (default) in
# the admin area
#   {{ cms:wysiwyg identifier }}
#
#
class ComfortableMediaSurfer::Content::Tags::Wysiwyg < ComfortableMediaSurfer::Content::Tags::Fragment
  def form_field(object_name, view, index)
    name    = "#{object_name}[fragments_attributes][#{index}][content]"
    data_attributes = { 'cms-rich-text' => true }

    if context.respond_to?(:site) && (site = context.site).present?
      data_attributes['defined-links-url'] =
        view.comfy_admin_cms_site_pages_path(site, source: 'rhino')
    end

    options = { id: form_field_id, data: data_attributes }
    input   = view.send(:text_area_tag, name, content, options)
    yield input
  end
end

ComfortableMediaSurfer::Content::Renderer.register_tag(
  :wysiwyg, ComfortableMediaSurfer::Content::Tags::Wysiwyg
)
