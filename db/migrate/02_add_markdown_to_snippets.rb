class AddMarkdownToSnippets < ActiveRecord::Migration[7.1]
  def change
    add_column :comfy_cms_snippets, :markdown, :boolean, default: false
  end
end