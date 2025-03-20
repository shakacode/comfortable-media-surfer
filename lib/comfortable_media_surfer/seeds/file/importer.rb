# frozen_string_literal: true

module ComfortableMediaSurfer::Seeds::File
  class Importer < ComfortableMediaSurfer::Seeds::Importer
    def initialize(from, to = from)
      super
      self.path = ::File.join(ComfortableMediaSurfer.config.seeds_path, from, 'files/')
    end

    def import!
      Dir["#{path}[^_]*"].each do |file_path|
        filename = ::File.basename(file_path)

        file = site.files.with_attached_attachment
          .where('active_storage_blobs.filename' => filename).references(:blob).first ||
               site.files.new

        if File.exist?(attrs_path = File.join(path, "_#{filename}.yml")) && fresh_seed?(file, attrs_path)
          attrs = YAML.safe_load_file(attrs_path)
          category_ids = category_names_to_ids(file, attrs.delete('categories'))
          file.attributes = attrs.merge(
            category_ids: category_ids
          )
          save(file, file_path)
        end

        if fresh_seed?(file, file_path)
          File.open(file_path) do |file_handler|
            file.file = {
              io: file_handler,
              filename: filename,
              content_type: MimeMagic.by_magic(file_handler)
            }
            save(file, file_path)
          end
        end

        seed_ids << file.id
      end

      # cleaning up
      site.files.where('id NOT IN (?)', seed_ids).destroy_all
    end

  private

    def save(file, path)
      if file.save
        ComfortableMediaSurfer.logger.info("[CMS SEEDS] Imported File \t #{path}")
      else
        ComfortableMediaSurfer.logger.warn("[CMS SEEDS] Failed to import File \n#{file.errors.inspect}")
      end
    end
  end
end
