# frozen_string_literal: true

module ComfortableMediaSurfer::Seeds::Snippet
  class Importer < ComfortableMediaSurfer::Seeds::Importer
    def initialize(from, to = from)
      super
      self.path = ::File.join(ComfortableMediaSurfer.config.seeds_path, from, 'snippets/')
    end

    def import!
      Dir.glob("#{path}/*.html").each do |path|
        identifier = File.basename(path, '.html')

        # reading file content in, resulting in a hash
        content_hash = parse_file_content(path)

        # parsing attributes section
        attributes_yaml = content_hash.delete('attributes')
        attrs           = YAML.safe_load(attributes_yaml)

        snippet = site.snippets.where(identifier: identifier).first_or_initialize

        if fresh_seed?(snippet, path)
          category_ids = category_names_to_ids(snippet, attrs.delete('categories'))

          snippet.attributes = attrs.merge(
            category_ids: category_ids,
            content: content_hash['content']
          )

          if snippet.save
            ComfortableMediaSurfer.logger.info("[CMS SEEDS] Imported Snippet \t #{snippet.identifier}")
          else
            ComfortableMediaSurfer.logger.warn("[CMS SEEDS] Failed to import Snippet \n#{snippet.errors.inspect}")
          end
        end

        # Tracking what page from seeds we're working with. So we can remove pages
        # that are no longer in seeds
        seed_ids << snippet.id
      end

      # cleaning up
      site.snippets.where('id NOT IN (?)', seed_ids).destroy_all
    end
  end
end
