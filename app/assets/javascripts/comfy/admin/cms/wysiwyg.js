import "rhino-editor";

/**
 * CMS WYSIWYG Adapter for Rhino Editor
 * This adapter provides a consistent interface for the CMS to interact with
 * the Rhino Editor, allowing for easy swapping of editor implementations.
 */
class CmsWysiwygAdapter {
  constructor(textarea) {
    this.textarea = textarea;
    this.editor = null;
    this.rhinoElement = null;
    this.isDirty = false;
  }

  /**
   * Initialize the Rhino Editor on the textarea
   */
  mount() {
    // Create rhino-editor element
    this.rhinoElement = document.createElement("rhino-editor");

    // Configure for native ActiveStorage Direct Upload
    this.rhinoElement.setAttribute('data-blob-url-template',
      '/rails/active_storage/blobs/redirect/:signed_id/:filename');
    this.rhinoElement.setAttribute('data-direct-upload-url',
      '/rails/active_storage/direct_uploads');

    // Insert the editor before the textarea and hide the textarea
    this.textarea.style.display = "none";
    this.textarea.parentNode.insertBefore(this.rhinoElement, this.textarea);

    // Wait for the editor to be fully initialized before setting content
    this.rhinoElement.addEventListener("rhino-initialize", () => {
      this.editor = this.rhinoElement.editor;

      // Get the raw initial content from the textarea
      const initialContent = this.textarea.value || "";

      // Set the content using the editor's API. Sanitization is not needed.
      if (initialContent) {
        this.editor.commands.setContent(initialContent, false);
      }

      this._setupEventListeners();
      this._setupFormSubmitHandler();
    });
  }

  /**
   * Set up event listeners for content changes
   */
  _setupEventListeners() {
    // Listen for content changes
    this.rhinoElement.addEventListener("rhino-change", () => {
      this._syncToTextarea();
      this.isDirty = true;
    });

    // Also listen for blur to ensure content is synced
    this.rhinoElement.addEventListener("rhino-blur", () => {
      this._syncToTextarea();
    });
  }

  /**
   * Set up form submit handler to ensure content is synced
   */
  _setupFormSubmitHandler() {
    // Find the parent form
    const form = this.textarea.closest('form');
    if (!form) return;

    // Listen for form submission
    form.addEventListener('submit', () => {
      // Force sync content to textarea before submission
      this._syncToTextarea();
    }, { capture: true });
  }


  /**
   * Sync editor content to the hidden textarea
   */
  _syncToTextarea() {
    if (this.editor) {
      // Use TipTap's getHTML() method to get the content
      this.textarea.value = this.editor.getHTML();
    } else if (this.rhinoElement) {
      // Fallback to value property if editor isn't initialized yet
      this.textarea.value = this.rhinoElement.value || "";
    }
  }

  /**
   * Get HTML content from the editor
   */
  getHtml() {
    if (this.editor) {
      return this.editor.getHTML();
    } else if (this.rhinoElement) {
      return this.rhinoElement.value || "";
    }
    return "";
  }

  /**
   * Set HTML content in the editor
   */
  setHtml(html) {
    if (this.editor) {
      // Use TipTap's setContent command
      this.editor.commands.setContent(html);
    } else if (this.rhinoElement) {
      // Set via value property before editor is initialized
      this.rhinoElement.value = html;
    }
    this._syncToTextarea();
    this.isDirty = false;
  }

  /**
   * Focus the editor
   */
  focus() {
    if (this.editor) {
      this.editor.commands.focus();
    }
  }

  /**
   * Destroy the editor instance
   */
  destroy() {
    if (this.editor) {
      this.editor.destroy();
    }
    if (this.rhinoElement) {
      this.rhinoElement.remove();
    }
    if (this.textarea) {
      this.textarea.style.display = "";
    }
    this.editor = null;
    this.rhinoElement = null;
  }
}

// Maintain the global CMS.wysiwyg interface for backward compatibility
const editorInstances = [];

window.CMS.wysiwyg = {
  init(root = document) {
    const textareas = root.querySelectorAll(
      "textarea.rich-text-editor, textarea[data-cms-rich-text]"
    );

    if (textareas.length === 0) return;

    for (const textarea of textareas) {
      const adapter = new CmsWysiwygAdapter(textarea);
      adapter.mount();
      editorInstances.push(adapter);
    }
  },

  dispose() {
    for (const adapter of editorInstances) {
      adapter.destroy();
    }
    editorInstances.length = 0;
  },
};
