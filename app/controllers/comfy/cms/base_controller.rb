# frozen_string_literal: true

class Comfy::Cms::BaseController < ComfortableMediaSurfer.config.public_base_controller.to_s.constantize
  before_action :load_cms_site

  helper Comfy::CmsHelper

protected

  def load_cms_site
    route_site_id = request.path_parameters[:site_id]
    @cms_site ||= if route_site_id
                    find_cms_site_for_asset(route_site_id)
                  else
                    ::Comfy::Cms::Site.find_site(request.host_with_port.downcase, request.fullpath)
                  end

    raise ActionController::RoutingError, 'Site Not Found' unless @cms_site

    return unless @cms_site.path.present? && !route_site_id
    raise ActionController::RoutingError, 'Site Not Found' unless params[:cms_path]&.match(%r{\A#{@cms_site.path}})

    params[:cms_path].gsub!(%r{\A#{@cms_site.path}}, '')
    params[:cms_path]&.gsub!(%r{\A/}, '')
  end

  def find_cms_site_for_asset(site_id)
    site = ::Comfy::Cms::Site.find_by_id(site_id)
    return site if site && ::Comfy::Cms::Site.one?
    return unless site

    request_host = ::Comfy::Cms::Site.real_host_from_aliases(request.host_with_port.downcase)
    site if site.hostname.downcase == request_host
  end
end
