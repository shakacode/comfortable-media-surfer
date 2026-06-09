# frozen_string_literal: true

module ComfortableMediaSurfer
  module Content
    # Decorates anchor tags in a blob of rendered HTML: marks external links
    # nofollow/blank and appends `so` tracking params to CTA links. Request-free
    # so it can run at content-cache generation time. The host and current path
    # are injected by the caller; CTA decoration only runs when a `cta_class` is
    # configured (and is a no-op on content with no matching anchors).
    class LinkDecorator
      def initialize(html, site_host:, current_path:, cta_class: nil)
        @html         = html.to_s
        @site_host    = site_host.to_s
        @current_path = current_path
        @cta_class    = cta_class
      end

      def call
        # No anchors → return the original bytes untouched. Parsing + re-serializing
        # would needlessly normalize the HTML (quote style, void tags, whitespace).
        return @html unless @html.match?(%r{<a[\s>]}i)

        fragment = Nokogiri::HTML.fragment(@html)
        fragment.css('a').each { |link| decorate_external(link) }
        cta_links(fragment).each_with_index { |link, index| decorate_cta(link, index) }
        fragment.to_html
      end

    private

      def cta_links(fragment)
        return [] if @cta_class.blank?

        fragment.css('a').select { |link| link['class'].to_s.include?(@cta_class) }
      end

      def decorate_external(link)
        href = link['href'].to_s
        return unless href.match?(%r{^http.?://}) && href.exclude?(@site_host)

        link['target'] = '_blank'
        link['rel']    = 'noopener nofollow'
      end

      def decorate_cta(link, index)
        return if link['href'].blank?

        source = "#{link.text.strip.parameterize}-#{index + 1}"
        uri    = URI.parse(link['href'])
        params = URI.decode_www_form(uri.query.to_s) << ['so', "#{@current_path}##{source}"]
        uri.query = URI.encode_www_form(params)
        link['href'] = uri.to_s
      rescue URI::InvalidURIError
        nil
      end
    end
  end
end
