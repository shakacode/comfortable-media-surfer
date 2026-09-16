# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'

class FilesFrontendTest < ApplicationSystemTestCase
  setup do
    @site     = comfy_cms_sites(:default)
    @layout   = comfy_cms_layouts(:default)
    @page     = comfy_cms_pages(:default)
    @file     = comfy_cms_files(:default)
    @file.attachment.blob.update_column(:content_type, 'application/pdf')
  end

  def test_site_file_drag_and_drop
    visit_p edit_comfy_admin_cms_site_page_path(@site, @page)

    open_files_modal
    assert_selector '.cms-files-modal #cms-uploader input[type=file]', visible: :all

    file_link = find('.cms-files-modal a[data-cms-file-link-tag]', text: 'default file')
    assert_equal "{{ cms:file_link #{@file.id} }}", drag_data(file_link)
    assert_no_selector '.cms-files-modal.show'
  end

  def test_page_file_drag_and_drop
    @layout.update_column(:content, <<~TEXT)
      {{ cms:files attachments, render: false }}
      {{ cms:text content }}
    TEXT

    comfy_cms_fragments(:default).update_column(:content, '')

    @page.update!(
      fragments_attributes: [{
        identifier: 'attachments',
        tag: 'files',
        files: fixture_file_upload('document.pdf', 'application/pdf')
      }]
    )

    visit_p edit_comfy_admin_cms_site_page_path(@site, @page)

    file_link = find('.fragment-attachments a[data-cms-file-link-tag]', text: 'document.pdf')
    assert_equal '{{ cms:page_file_link attachments, filename: "document.pdf" }}', drag_data(file_link)
  end

  def test_files_modal_dispose_and_reinitialize
    visit_p edit_comfy_admin_cms_site_page_path(@site, @page)
    page.execute_script <<~JS
      window.__cmsFetchCount = 0;
      window.__cmsFetch = window.fetch;
      window.fetch = (...args) => {
        window.__cmsFetchCount += 1;
        return window.__cmsFetch(...args);
      };
    JS

    open_files_modal
    assert_equal 1, page.evaluate_script('window.__cmsFetchCount')

    page.execute_script <<~JS
      window.CMS.dispose();
      document.querySelector('.cms-files-modal .modal-content').innerHTML = '';
      window.CMS.init();
    JS

    open_files_modal
    assert_equal 2, page.evaluate_script('window.__cmsFetchCount')
  end

  def test_hostile_upload_filename_is_rendered_as_text
    filename = '<img src=x onerror=window.__uploadXss=true>.txt'

    Dir.mktmpdir do |directory|
      path = File.join(directory, filename)
      File.binwrite(path, 'safe content')

      visit_p comfy_admin_cms_site_files_path(@site)
      page.execute_script('window.__uploadXss = false')
      find('#cms-uploader input[type=file]', visible: :all).set(path)

      assert_link filename
      assert_equal false, page.evaluate_script('window.__uploadXss')
      assert_no_selector '#cms-uploader img[src="x"]', visible: :all
    end
  end

private

  def open_files_modal
    page.execute_script <<~JS
      const modal = document.querySelector('.cms-files-modal');
      modal.dataset.cmsShown = 'false';
      window.jQuery(modal).one('shown.bs.modal', () => {
        modal.dataset.cmsShown = 'true';
      });
    JS
    find('.cms-files-open-modal').click
    assert_selector '.cms-files-modal.show[data-cms-shown="true"]'
    assert_selector '.cms-files-modal a[data-cms-file-link-tag]', text: 'default file'
  end

  def drag_data(element)
    page.evaluate_script(<<~JS, element)
      ((link) => {
        const dataTransfer = new DataTransfer();
        link.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
        return dataTransfer.getData('text/plain');
      })(arguments[0]);
    JS
  end
end
