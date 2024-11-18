class AddMarkdownToComfyCmsSnippets < ActiveRecord::Migration[6.1]
  def change
    add_column :comfy_cms_snippets, :markdown, :boolean, default: false
  end
end
