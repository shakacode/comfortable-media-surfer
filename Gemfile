# frozen_string_literal: true

source 'https://rubygems.org'
git_source(:github) { |repo| "https://github.com/#{repo}.git" }

gemspec

gem 'rails', '~> 8.0'

group :development, :test do
  gem 'autoprefixer-rails', '~> 10.4.21.0'
  gem 'byebug',             '~> 12.0.0', platforms: %i[mri mingw x64_mingw]
  gem 'gem-release'
  gem 'image_processing',   '>= 1.12.0'
  gem 'propshaft',          '~> 1.1.0'
  gem 'sqlite3',            '>= 2.1'
  # gem 'mysql2',             '~> 0.5'
  # gem 'pg',                 '~> 1.5.4'
end

group :development do
  gem 'listen',       '~> 3.9.0'
  gem 'web-console',  '~> 4.2'
end

group :test do
  gem 'brakeman',                 '~> 7.0.2'
  gem 'bundler-audit',            '~> 0.9.1'
  gem 'coveralls_reborn',         '~> 0.29.0', require: false
  gem 'cuprite',                  '>= 0.15'
  gem 'equivalent-xml',           '~> 0.6.0'
  gem 'minitest',                 '>= 5.23.0'
  gem 'minitest-reporters',       '>= 1.6.1'
  gem 'mocha',                    '>= 2.3.0', require: false
  gem 'ostruct'
  gem 'puma'
  gem 'rails-controller-testing', '~> 1.0.5'
  gem 'rubocop',                  '~> 1.77.0', require: false
  gem 'rubocop-minitest'
  gem 'rubocop-rails'
  gem 'simplecov', '~> 0.22.0', require: false
end
