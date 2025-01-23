# frozen_string_literal: true

namespace :comfy do
  desc 'Compile SCSS and JS assets for propshaft.'
  task :compile_assets do
    puts 'Compiling assets...'
    dir = File.expand_path("#{__dir__}/..")
    Dir.chdir(dir) do
      unless system('npm install')
        puts 'Error: Failed to install npm packages.'
        exit(-1)
      end
      unless system('npm run build && npm run build:css')
        puts 'Error: Failed to compile assets'
        exit(-1)
      end
    end
  end
end
