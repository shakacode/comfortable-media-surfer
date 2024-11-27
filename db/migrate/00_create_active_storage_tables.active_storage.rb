class CreateActiveStorageTables < ActiveRecord::Migration[6.0]
  def change
    create_table :active_storage_blobs do |t|
      t.string   :key,        null: false
      t.string   :filename,   null: false
      t.string   :content_type
      t.string   :service_name, null: false
      t.text     :metadata
      t.bigint   :byte_size,  null: false
      t.string   :checksum,   null: true
      t.datetime :created_at, null: false

      t.index [ :key ], unique: true
    end

    if configured_service = ActiveStorage::Blob.service.name
      ActiveStorage::Blob.unscoped.update_all(service_name: configured_service)
    end

    create_table :active_storage_attachments do |t|
      t.string     :name,     null: false
      t.references :record,   null: false, polymorphic: true, index: false
      t.references :blob,     null: false

      t.datetime :created_at, null: false

      t.index [ :record_type, :record_id, :name, :blob_id ], name: "index_active_storage_attachments_uniqueness", unique: true
    end

    create_table :active_storage_variant_records, id: primary_key_type, if_not_exists: true do |t|
      t.belongs_to :blob, null: false, index: false, type: blobs_primary_key_type
      t.string :variation_digest, null: false

      t.index %i[ blob_id variation_digest ], name: "index_active_storage_variant_records_uniqueness", unique: true
      t.foreign_key :active_storage_blobs, column: :blob_id
    end
  end

  private
    def primary_key_type
      config = Rails.configuration.generators
      config.options[config.orm][:primary_key_type] || :primary_key
    end

    def blobs_primary_key_type
      pkey_name = connection.primary_key(:active_storage_blobs)
      pkey_column = connection.columns(:active_storage_blobs).find { |c| c.name == pkey_name }
      pkey_column.bigint? ? :bigint : pkey_column.type
    end
end
