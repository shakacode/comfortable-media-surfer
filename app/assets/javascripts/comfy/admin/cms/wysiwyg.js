import "rhino-editor";
import CodeMirror from "codemirror";
import "codemirror/mode/xml/xml";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/css/css";
import "codemirror/mode/htmlmixed/htmlmixed";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/edit/matchtags";
import "codemirror/addon/selection/active-line";
import { html as beautifyHtml } from "js-beautify";
import TableOfContents from "@tiptap/extension-table-of-contents";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import CmsTableOfContentsNode from "./extensions/table_of_contents";
import IframeExtension from "./extensions/iframe";
import ResizableImage from "./extensions/resizable_image";

const DEBUG_DEFINED_LINKS = (() => {
  if (typeof window === "undefined") return false;
  if (window?.CMS?.DEBUG_DEFINED_LINKS !== undefined) {
    return Boolean(window.CMS.DEBUG_DEFINED_LINKS);
  }
  try {
    const stored = window.localStorage?.getItem("cmsDebugDefinedLinks");
    if (stored !== null) {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage access issues (e.g., Safari private browsing)
  }
  return true;
})();

function debugDefinedLinks(...args) {
  if (!DEBUG_DEFINED_LINKS) return;
  // console.debug("[CMS defined links]", ...args);
}

const DEFINED_LINKS_CACHE = new Map();
let SOURCE_DIALOG_COUNTER = 0;

const HTML_FORMAT_OPTIONS = Object.freeze({
  indent_size: 2,
  indent_char: " ",
  indent_with_tabs: false,
  indent_inner_html: true,
  preserve_newlines: true,
  max_preserve_newlines: 2,
  wrap_line_length: 0,
  extra_liners: [],
  end_with_newline: true
});

const TABLE_INSERT_DEFAULTS = Object.freeze({
  rows: 3,
  cols: 3,
  withHeaderRow: true
});

const TABLE_ACTIONS = [
  { key: "delete-table", label: "Delete table", command: "deleteTable" },
  { key: "add-column-before", label: "Add column before", command: "addColumnBefore" },
  { key: "add-column-after", label: "Add column after", command: "addColumnAfter" },
  { key: "delete-column", label: "Delete column", command: "deleteColumn" },
  { key: "add-row-before", label: "Add row before", command: "addRowBefore" },
  { key: "add-row-after", label: "Add row after", command: "addRowAfter" },
  { key: "delete-row", label: "Delete row", command: "deleteRow" },
  { key: "merge-cells", label: "Merge cells", command: "mergeCells" },
  { key: "split-cell", label: "Split cell", command: "splitCell" },
  { key: "merge-or-split", label: "Merge or split", command: "mergeOrSplit" },
  { key: "toggle-header-row", label: "Toggle header row", command: "toggleHeaderRow" },
  { key: "toggle-header-column", label: "Toggle header column", command: "toggleHeaderColumn" },
  { key: "toggle-header-cell", label: "Toggle header cell", command: "toggleHeaderCell" }
];

const TABLE_ACTION_LOOKUP = new Map(
  TABLE_ACTIONS.map((action) => [action.key, action])
);

function invokeChainCommand(chain, commandName, args = []) {
  if (!chain || typeof chain[commandName] !== "function") return null;
  const normalizedArgs = Array.isArray(args)
    ? args
    : args === undefined
    ? []
    : [args];
  return chain[commandName](...normalizedArgs);
}

function runEditorCommand(editor, commandName, args) {
  if (!editor || typeof editor.chain !== "function") return false;
  const chain = editor.chain().focus();
  const result = invokeChainCommand(chain, commandName, args);
  if (!result || typeof result.run !== "function") return false;
  return result.run();
}

function canRunEditorCommand(editor, commandName, args) {
  if (!editor || typeof editor.can !== "function") return false;
  const chain = editor.can().chain().focus();
  const result = invokeChainCommand(chain, commandName, args);
  if (!result || typeof result.run !== "function") return false;
  return result.run();
}

class DefinedLinksPicker {
  constructor(adapter, url) {
    this.adapter = adapter;
    this.url = url;
    this.shadowRoot = null;
    this.observer = null;
    this.input = null;
    this.originalPlaceholder = null;
    this.container = null;
    this.list = null;
    this.links = [];
    this.visibleOptions = [];
    this.isFetching = false;
    this.fetchError = null;
    this.highlightedIndex = -1;
    this.lastLoggedQuery = null;
    this.hasLoggedMissingInput = false;
    this.hasLoggedMissingContainer = false;
    this.hasShownContainer = false;

    this.handleInput = this.handleInput.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleListMouseDown = this.handleListMouseDown.bind(this);
    this.handleListClick = this.handleListClick.bind(this);
    this.handleMutations = this.handleMutations.bind(this);

    debugDefinedLinks("DefinedLinksPicker constructed", { url });
  }

  observe(shadowRoot) {
    if (!this.url) {
      debugDefinedLinks("observe skipped: no defined links URL");
      return;
    }
    if (!shadowRoot) {
      debugDefinedLinks("observe skipped: shadow root unavailable");
      return;
    }
    debugDefinedLinks("Observing Rhino link dialog", { url: this.url });
    this.shadowRoot = shadowRoot;
    if (this.observer) {
      this.observer.disconnect();
    }
    this.observer = new MutationObserver(this.handleMutations);
    this.observer.observe(shadowRoot, { childList: true, subtree: true });
    this.sync();
  }

  handleMutations(mutations) {
    if (!mutations || mutations.length === 0) return;

    if (this.container) {
      const internalMutations = mutations.every((mutation) =>
        this.container.contains(mutation.target)
      );

      if (internalMutations) {
        debugDefinedLinks("Skipping self-induced mutations");
        return;
      }
    }

    debugDefinedLinks("External mutation detected; syncing picker");
    this.sync();
  }

  decorateLinkDialogContainer(dialogContainer) {
    if (!dialogContainer) return;

    const existingContainerPart = dialogContainer.getAttribute("part") || "";
    const containerTokens = new Set(
      existingContainerPart.split(/\s+/).filter(Boolean)
    );
    containerTokens.add("link-dialog__container");
    dialogContainer.setAttribute("part", Array.from(containerTokens).join(" "));

    const buttons = dialogContainer.querySelector(".link-dialog__buttons");
    if (buttons) {
      const buttonsPart = buttons.getAttribute("part") || "";
      const buttonTokens = new Set(
        buttonsPart.split(/\s+/).filter(Boolean)
      );
      buttonTokens.add("link-dialog__buttons");
      buttons.setAttribute("part", Array.from(buttonTokens).join(" "));
    }
  }

  showContainer() {
    if (!this.container) return;
    if (!this.container.hidden) return;
    this.container.hidden = false;
    this.container.removeAttribute("aria-hidden");
    this.hasShownContainer = true;
    debugDefinedLinks("Defined links container revealed");
  }

  sync() {
    if (!this.shadowRoot) {
      debugDefinedLinks("sync skipped: missing shadow root");
      return;
    }
    const input = this.shadowRoot.querySelector("#link-dialog__input");
    if (!input) {
      if (!this.hasLoggedMissingInput) {
        debugDefinedLinks("Waiting for link dialog input");
        this.hasLoggedMissingInput = true;
      }
      return;
    }

    if (this.hasLoggedMissingInput) {
      debugDefinedLinks("Link dialog input located");
      this.hasLoggedMissingInput = false;
    }

    if (this.input !== input) {
      this.detachInput();
      this.attachInput(input);
    }

    if (!this.container) {
      const dialogContainer = this.shadowRoot.querySelector(
        "#link-dialog .link-dialog__container"
      );
      if (!dialogContainer) {
        if (!this.hasLoggedMissingContainer) {
          debugDefinedLinks("Waiting for link dialog container");
          this.hasLoggedMissingContainer = true;
        }
        return;
      }

      this.decorateLinkDialogContainer(dialogContainer);

      if (this.hasLoggedMissingContainer) {
        debugDefinedLinks("Link dialog container located");
        this.hasLoggedMissingContainer = false;
      }

      debugDefinedLinks("Injecting defined links UI scaffold");

      this.container = document.createElement("div");
      this.container.className = "cms-defined-links";
      this.container.setAttribute("part", "cms-defined-links");
      this.container.hidden = true;
      this.container.setAttribute("aria-hidden", "true");

      const label = document.createElement("div");
      label.className = "cms-defined-links__label";
      label.textContent = "Link to CMS page or file";
  label.setAttribute("part", "cms-defined-links__label");

      this.list = document.createElement("ul");
      this.list.className = "cms-defined-links__results";
      this.list.setAttribute("role", "listbox");
      this.list.id = "cms-defined-links-results";
      this.list.setAttribute("aria-label", "CMS pages and files suggestions");
  this.list.setAttribute("part", "cms-defined-links__results");
      this.list.addEventListener("mousedown", this.handleListMouseDown);
      this.list.addEventListener("click", this.handleListClick);

      this.container.append(label, this.list);
      dialogContainer.appendChild(this.container);
      debugDefinedLinks("Defined links UI mounted");
    }

    if (!this.links.length && !this.isFetching && !this.fetchError) {
      debugDefinedLinks("No cached links available; initiating fetch");
      this.fetchLinks();
    } else {
      this.updateList(this.input?.value || "");
    }
  }

  attachInput(input) {
    debugDefinedLinks("Attaching to link dialog input", {
      placeholder: input.getAttribute("placeholder"),
    });
    this.input = input;
    this.originalPlaceholder =
      this.originalPlaceholder ?? input.getAttribute("placeholder") ?? "";
    input.setAttribute(
      "placeholder",
      `Enter URL or search CMS pages/files`
    );
    input.setAttribute("aria-controls", "cms-defined-links-results");
    input.addEventListener("input", this.handleInput);
    input.addEventListener("keydown", this.handleKeyDown);
    this.lastLoggedQuery = null;
  }

  detachInput() {
    if (!this.input) return;
    debugDefinedLinks("Detaching from link dialog input");
    this.input.removeEventListener("input", this.handleInput);
    this.input.removeEventListener("keydown", this.handleKeyDown);
    if (this.originalPlaceholder !== null) {
      this.input.setAttribute("placeholder", this.originalPlaceholder);
    }
    this.input.removeAttribute("aria-controls");
    this.input = null;
  }

  async fetchLinks() {
    debugDefinedLinks("fetchLinks invoked", { url: this.url });
    if (!this.url) {
      debugDefinedLinks("fetchLinks aborted: missing URL");
      return;
    }

    if (DEFINED_LINKS_CACHE.has(this.url)) {
      this.links = DEFINED_LINKS_CACHE.get(this.url);
      this.fetchError = null;
      debugDefinedLinks("Using cached defined links", {
        count: this.links.length,
      });
      this.updateList(this.input?.value || "");
      return;
    }

    this.isFetching = true;
    this.fetchError = null;
    this.updateList(this.input?.value || "");
    debugDefinedLinks("Fetching defined links from server", { url: this.url });

    try {
      const response = await fetch(this.url, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const links = Array.isArray(data)
        ? data.filter((item) => item && item.url)
        : [];

      this.links = links;
      DEFINED_LINKS_CACHE.set(this.url, links);
      debugDefinedLinks("Fetched defined links", { count: links.length });
    } catch (error) {
      console.error("CMS defined links fetch failed", error);
      debugDefinedLinks("Error fetching defined links", error);
      this.fetchError = error;
    } finally {
      this.isFetching = false;
      this.updateList(this.input?.value || "");
    }
  }
  handleInput(event) {
    this.highlightedIndex = -1;
    debugDefinedLinks("User input updated", { value: event.target.value });
    this.showContainer();
    this.updateList(event.target.value);
  }

  handleKeyDown(event) {
    if (!this.visibleOptions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      debugDefinedLinks("Keyboard navigation", { action: "ArrowDown" });
      this.showContainer();
      this.moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      debugDefinedLinks("Keyboard navigation", { action: "ArrowUp" });
      this.showContainer();
      this.moveHighlight(-1);
    } else if (event.key === "Enter" && this.highlightedIndex >= 0) {
      event.preventDefault();
      debugDefinedLinks("Keyboard navigation", {
        action: "Enter",
        highlightedIndex: this.highlightedIndex,
      });
      const option = this.visibleOptions[this.highlightedIndex];
      if (option) this.applyOption(option);
    }
  }

  handleListMouseDown(event) {
    const optionEl = event.target.closest("[data-defined-link-index]");
    if (optionEl) {
      event.preventDefault();
      debugDefinedLinks("Mouse down on option", {
        index: Number.parseInt(optionEl.dataset.definedLinkIndex, 10),
      });
    }
  }

  handleListClick(event) {
    const optionEl = event.target.closest("[data-defined-link-index]");
    if (!optionEl) return;
    const index = Number.parseInt(optionEl.dataset.definedLinkIndex, 10);
    const option = this.visibleOptions[index];
    if (option) {
      debugDefinedLinks("Mouse click on option", {
        index,
        name: option.name,
        url: option.url,
      });
      this.applyOption(option);
    }
  }

  moveHighlight(delta) {
    if (!this.visibleOptions.length) return;
    const length = this.visibleOptions.length;
    if (this.highlightedIndex === -1) {
      this.highlightedIndex = delta > 0 ? 0 : length - 1;
    } else {
      this.highlightedIndex =
        (this.highlightedIndex + delta + length) % length;
    }
    debugDefinedLinks("Highlight moved", {
      highlightedIndex: this.highlightedIndex,
      total: length,
    });
    this.renderHighlight();
    this.ensureHighlightedVisible();
  }

  ensureHighlightedVisible() {
    if (!this.list || this.highlightedIndex < 0) return;
    const item = this.list.querySelector(
      `[data-defined-link-index="${this.highlightedIndex}"]`
    );
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }

  renderHighlight() {
    if (!this.list) return;
    const items = this.list.querySelectorAll("[data-defined-link-index]");
    items.forEach((item) => {
      const index = Number.parseInt(item.dataset.definedLinkIndex, 10);
      const isActive = index === this.highlightedIndex;
      item.classList.toggle("is-highlighted", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  createStatusItem(text) {
    const item = document.createElement("li");
    item.className = "cms-defined-links__status";
    item.textContent = text;
    item.setAttribute("role", "option");
    item.setAttribute("aria-disabled", "true");
    item.setAttribute("part", "cms-defined-links__status");
    return item;
  }

  updateList(value = "") {
    if (!this.list) return;

    const query = value.trim().toLowerCase();

    if (this.lastLoggedQuery !== query || this.isFetching) {
      debugDefinedLinks("updateList invoked", {
        query,
        totalLinks: this.links.length,
        isFetching: this.isFetching,
        hasError: Boolean(this.fetchError),
      });
      this.lastLoggedQuery = query;
    }

    this.list.innerHTML = "";

    if (this.fetchError) {
      debugDefinedLinks("Rendering fetch error state");
      this.list.appendChild(
        this.createStatusItem("Unable to load CMS resources")
      );
      return;
    }

    if (!this.links.length) {
      if (this.isFetching) {
        debugDefinedLinks("Awaiting fetch results");
        this.list.appendChild(this.createStatusItem("Loading…"));
      } else {
        debugDefinedLinks("No resources available after fetch");
        this.list.appendChild(this.createStatusItem("No resources available"));
      }
      return;
    }

    const matches = (query
      ? this.links.filter((link) => {
          const name = link.name?.toLowerCase() || "";
          const url = link.url?.toLowerCase() || "";
          return name.includes(query) || url.includes(query);
        })
      : this.links.slice(0, 8)) || [];

    this.visibleOptions = matches;
    if (matches.length === 0) {
      const message = query
        ? "No matches"
        : "No resources available";
      debugDefinedLinks("No matches for query", { query });
      this.list.appendChild(this.createStatusItem(message));
      this.highlightedIndex = -1;
      return;
    }

    matches.forEach((option, index) => {
      const item = document.createElement("li");
      item.className = "cms-defined-links__option";
      item.setAttribute("role", "option");
      item.dataset.definedLinkIndex = String(index);
      item.setAttribute("part", "cms-defined-links__option");

      // Add icon for type (page vs file)
      const icon = document.createElement("span");
      icon.className = "cms-defined-links__option-icon";
      icon.textContent = this.getIcon(option);
      icon.setAttribute("part", "cms-defined-links__option-icon");

      const details = document.createElement("div");
      details.className = "cms-defined-links__option-details";
      details.setAttribute("part", "cms-defined-links__option-details");

      const name = document.createElement("span");
      name.className = "cms-defined-links__option-name";
      name.textContent = option.name;
      name.setAttribute("part", "cms-defined-links__option-name");

      const url = document.createElement("span");
      url.className = "cms-defined-links__option-url";
      url.textContent = option.url;
      url.setAttribute("part", "cms-defined-links__option-url");

      details.append(name, url);
      
      // Add file size if available
      if (option.size) {
        const size = document.createElement("span");
        size.className = "cms-defined-links__option-size";
        size.textContent = option.size;
        size.setAttribute("part", "cms-defined-links__option-size");
        details.appendChild(size);
      }

      item.append(icon, details);
      this.list.appendChild(item);
    });

    if (this.highlightedIndex >= matches.length) {
      this.highlightedIndex = -1;
    }
    debugDefinedLinks("Rendered options", { count: matches.length });
    this.renderHighlight();
  }

  getIcon(option) {
    // If it has a content_type, it's a file
    if (option.content_type) {
      const contentType = option.content_type;
      if (contentType.startsWith('image/')) return '🖼️';
      if (contentType.startsWith('video/')) return '🎥';
      if (contentType.startsWith('audio/')) return '🎵';
      if (contentType.includes('pdf')) return '📄';
      if (contentType.includes('zip') || contentType.includes('archive')) return '📦';
      if (contentType.includes('text')) return '📝';
      return '📎';
    }
    // Otherwise it's a page
    return '📄';
  }

  applyOption(option) {
    if (!option || !option.url) return;
    debugDefinedLinks("Applying defined link", {
      name: option.name,
      url: option.url,
    });

    if (this.input) {
      this.input.value = option.url;
      const event = new Event("input", { bubbles: true, cancelable: true });
      this.input.dispatchEvent(event);
    }

    const editor = this.adapter.editor;

    if (editor) {
      const { selection } = editor.state;
      if (selection.empty) {
        const from = selection.anchor;
        editor.commands.insertContent(option.name);
        const to = editor.state.selection.anchor;
        editor.commands.setTextSelection({ from, to });
      }

      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: option.url })
        .run();
    }

    if (this.adapter.rhinoElement?.closeLinkDialog) {
      this.adapter.rhinoElement.closeLinkDialog();
    }

    this.adapter._syncToTextarea?.();
    this.highlightedIndex = -1;
    this.renderHighlight();
  }

  destroy() {
    debugDefinedLinks("Destroying defined links picker");
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.detachInput();
    if (this.list) {
      this.list.removeEventListener("mousedown", this.handleListMouseDown);
      this.list.removeEventListener("click", this.handleListClick);
    }
    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.list = null;
    this.shadowRoot = null;
    this.visibleOptions = [];
  }
}

// DefinedFilesPicker class - fetches and merges both pages and files, plus handles uploads
class DefinedFilesPicker {
  constructor(adapter, pagesUrl, filesUrl, uploadUrl) {
    this.adapter = adapter;
    this.pagesUrl = pagesUrl;
    this.filesUrl = filesUrl;
    this.uploadUrl = uploadUrl;
    this.linksPickerDelegate = null;
    this.uploadContainer = null;
    this.fileInput = null;
    this.uploadButton = null;
    this.uploadStatus = null;
    this.isUploading = false;
    
    this.handleFileSelect = this.handleFileSelect.bind(this);
    this.handleUploadClick = this.handleUploadClick.bind(this);
  }

  observe(shadowRoot) {
    if (!shadowRoot) return;
    
    // Combine both URLs into a unified list
    const combinedUrl = this._createCombinedUrl();
    
    if (!this.linksPickerDelegate) {
      this.linksPickerDelegate = new DefinedLinksPicker(this.adapter, combinedUrl);
      // Override fetchLinks to fetch from both sources
      this.linksPickerDelegate.fetchLinks = async () => {
        await this._fetchCombinedLinks();
      };
      
      // After container is created, inject upload UI
      const originalSync = this.linksPickerDelegate.sync.bind(this.linksPickerDelegate);
      this.linksPickerDelegate.sync = () => {
        originalSync();
        this._injectUploadUI();
      };
    }
    
    this.linksPickerDelegate.observe(shadowRoot);
  }

  _injectUploadUI() {
    if (!this.uploadUrl) return;
    if (this.uploadContainer) return; // Already injected
    if (!this.linksPickerDelegate.container) return;

    debugDefinedLinks("Injecting file upload UI");

    this.uploadContainer = document.createElement("div");
    this.uploadContainer.className = "cms-file-upload";
    this.uploadContainer.setAttribute("part", "cms-file-upload");

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", this.handleFileSelect);

    this.uploadButton = document.createElement("button");
    this.uploadButton.type = "button";
    this.uploadButton.className = "cms-file-upload__button";
    this.uploadButton.setAttribute("part", "cms-file-upload__button");
    this.uploadButton.textContent = "Upload New File";
    this.uploadButton.addEventListener("click", this.handleUploadClick);

    this.uploadStatus = document.createElement("span");
    this.uploadStatus.className = "cms-file-upload__status";
    this.uploadStatus.setAttribute("part", "cms-file-upload__status");
    this.uploadStatus.textContent = "Choose a file to link";

    this.uploadContainer.append(this.uploadButton, this.uploadStatus, this.fileInput);
    
    // Insert before the list
    const list = this.linksPickerDelegate.list;
    if (list && list.parentNode) {
      list.parentNode.insertBefore(this.uploadContainer, list);
    }
  }

  handleUploadClick() {
    if (this.isUploading) return;
    this.fileInput.click();
  }

  async handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    debugDefinedLinks("File selected for upload", { filename: file.name, size: file.size });

    this.isUploading = true;
    this.uploadButton.disabled = true;
    this.uploadStatus.textContent = `Uploading ${file.name}...`;

    try {
      const formData = new FormData();
      formData.append("file[file]", file);
      formData.append("source", "rhino");

      const response = await fetch(this.uploadUrl, {
        method: "POST",
        body: formData,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json"
        },
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(`Upload failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      debugDefinedLinks("File upload successful", data);

      const fileUrl = data.filelink;
      const fileName = data.filename || file.name;

      this.uploadStatus.textContent = `✓ Uploaded: ${fileName}`;

      // Auto-apply the link
      this._applyUploadedFile(fileUrl, fileName);

      // Clear the file input
      this.fileInput.value = "";

      // Invalidate cache to refresh file list
      const cacheKey = `combined:${this.pagesUrl}:${this.filesUrl}`;
      DEFINED_LINKS_CACHE.delete(cacheKey);
      
      // Refresh the file list
      if (this.linksPickerDelegate) {
        await this._fetchCombinedLinks();
      }

    } catch (error) {
      console.error("File upload failed", error);
      this.uploadStatus.textContent = `✗ Upload failed: ${error.message}`;
    } finally {
      this.isUploading = false;
      this.uploadButton.disabled = false;
      
      // Reset status after 3 seconds
      setTimeout(() => {
        if (this.uploadStatus) {
          this.uploadStatus.textContent = "Choose a file to link";
        }
      }, 3000);
    }
  }

  _applyUploadedFile(url, name) {
    if (!url) return;
    
    debugDefinedLinks("Auto-applying uploaded file link", { url, name });

    const editor = this.adapter.editor;

    if (editor) {
      const { selection } = editor.state;
      
      // If no text is selected, insert the filename as link text
      if (selection.empty) {
        const from = selection.anchor;
        editor.commands.insertContent(name);
        const to = editor.state.selection.anchor;
        editor.commands.setTextSelection({ from, to });
      }

      // Apply the link
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }

    // Close the link dialog
    if (this.adapter.rhinoElement?.closeLinkDialog) {
      this.adapter.rhinoElement.closeLinkDialog();
    }

    this.adapter._syncToTextarea?.();
  }

  _createCombinedUrl() {
    // We'll use a placeholder URL since we're overriding fetchLinks anyway
    return this.pagesUrl || this.filesUrl || '';
  }

  async _fetchCombinedLinks() {
    const delegate = this.linksPickerDelegate;
    if (!delegate) return;

    const cacheKey = `combined:${this.pagesUrl}:${this.filesUrl}`;
    
    if (DEFINED_LINKS_CACHE.has(cacheKey)) {
      delegate.links = DEFINED_LINKS_CACHE.get(cacheKey);
      delegate.fetchError = null;
      debugDefinedLinks("Using cached combined links", {
        count: delegate.links.length,
      });
      delegate.updateList(delegate.input?.value || "");
      return;
    }

    delegate.isFetching = true;
    delegate.fetchError = null;
    delegate.updateList(delegate.input?.value || "");
    debugDefinedLinks("Fetching combined pages and files");

    try {
      const fetchPromises = [];
      
      if (this.pagesUrl) {
        fetchPromises.push(
          fetch(this.pagesUrl, {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          })
        );
      }
      
      if (this.filesUrl) {
        fetchPromises.push(
          fetch(this.filesUrl, {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          })
        );
      }

      const responses = await Promise.all(fetchPromises);
      
      const dataPromises = responses.map(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
      });

      const allData = await Promise.all(dataPromises);
      
      // Combine and filter
      const combinedLinks = allData
        .flat()
        .filter((item) => item && item.url);

      delegate.links = combinedLinks;
      DEFINED_LINKS_CACHE.set(cacheKey, combinedLinks);
      debugDefinedLinks("Fetched combined links", { count: combinedLinks.length });
    } catch (error) {
      console.error("CMS combined links fetch failed", error);
      debugDefinedLinks("Error fetching combined links", error);
      delegate.fetchError = error;
    } finally {
      delegate.isFetching = false;
      delegate.updateList(delegate.input?.value || "");
    }
  }

  destroy() {
    if (this.fileInput) {
      this.fileInput.removeEventListener("change", this.handleFileSelect);
      this.fileInput = null;
    }
    if (this.uploadButton) {
      this.uploadButton.removeEventListener("click", this.handleUploadClick);
      this.uploadButton = null;
    }
    if (this.uploadContainer) {
      this.uploadContainer.remove();
      this.uploadContainer = null;
    }
    if (this.linksPickerDelegate) {
      this.linksPickerDelegate.destroy();
      this.linksPickerDelegate = null;
    }
    this.uploadStatus = null;
  }
}

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
    this._definedLinksPicker = null;
    this._loggedMissingShadowRoot = false;
    this._loggedMissingDefinedLinksUrl = false;
    this._sourceButton = null;
    this._sourceDialog = null;
    this._sourceTextarea = null;
    this._sourceCancelButton = null;
    this._sourceApplyButton = null;
    this._sourceCloseButton = null;
    this._sourceBackdrop = null;
    this._lastFocusedElement = null;
    this._sourceFocusables = [];
    this._isSourceDialogOpen = false;
    this._sourceDialogKey = ++SOURCE_DIALOG_COUNTER;
    this._previousBodyOverflow = null;
    this._sourceEditor = null;
    this._boundSourceToggle = this._handleSourceToggle.bind(this);
    this._boundSourceApply = this._handleSourceApply.bind(this);
    this._boundSourceCancel = this._handleSourceCancel.bind(this);
    this._boundSourceKeydown = this._handleSourceKeydown.bind(this);
  	this._tocItems = [];
  	this._lastRenderedTocItems = "[]";
    this._tocToggleButton = null;
    this._boundTocToggle = this._handleTocToggle.bind(this);
    this._imageResizeControls = null;
    this._imageResetButton = null;
    this._imageAspectRatioButton = null;
    this._boundImageReset = this._handleImageReset.bind(this);
    this._boundImageAspectRatioToggle = this._handleImageAspectRatioToggle.bind(this);
    this._boundRhinoUpdate = this._handleRhinoUpdate.bind(this);
    this._isReplacingAttachments = false;
    this._tableInsertButton = null;
    this._tableMenu = null;
    this._tableActionButtons = new Map();
    this._tableSelectionUnsubscribe = null;
    this._tableTransactionUnsubscribe = null;
    this._boundTableInsert = this._handleTableInsert.bind(this);
    this._boundTableMenuClick = this._handleTableMenuClick.bind(this);
    this._boundTableUpdate = () => this._updateTableControls();
  }

  /**
   * Initialize the Rhino Editor on the textarea
   */
  mount() {
    // Create rhino-editor element
    this.rhinoElement = document.createElement("rhino-editor");
  	this.rhinoElement.addEventListener("rhino-update", this._boundRhinoUpdate);

    const tableOfContentsExtension = TableOfContents.configure({
      onUpdate: (items = []) => {
        this._handleTocUpdate(items);
      }
    });

    const tableExtension = Table.configure({
      resizable: true,
      allowTableNodeSelection: true
    });

    // Configure Rhino to exclude default Image extension, then add our resizable version
    // We need to set this BEFORE the editor initializes
    this.rhinoElement.starterKitOptions = {
      image: false  // Disable default image extension
    };

    this.rhinoElement.addExtensions(
      IframeExtension,
      tableOfContentsExtension,
      CmsTableOfContentsNode,
      ResizableImage,
      tableExtension,
      TableRow,
      TableHeader,
      TableCell
    );

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
      this._decorateLinkDialog();
      this._setupSourceToggle();
      this._setupTocToggle();
      this._setupImageResizeControls();
    this._setupTableControls();
  		this._replaceAttachmentFiguresWithImages();
      const existingToc = this._findTocNode();
      if (existingToc?.node?.attrs?.items) {
        const itemsAttr = existingToc.node.attrs.items;
        this._lastRenderedTocItems = itemsAttr;
        try {
          const parsed = JSON.parse(itemsAttr);
          this._tocItems = Array.isArray(parsed) ? parsed : [];
        } catch (_error) {
          this._tocItems = [];
        }
      } else {
        this._tocItems = [];
        this._lastRenderedTocItems = "[]";
      }
      this._updateTocButtonState();
      if (this.editor?.commands?.updateTableOfContents) {
        this.editor.commands.updateTableOfContents();
      }
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
   * Enhance the Rhino link dialog with the CMS defined-links picker.
   */
  _decorateLinkDialog() {
    if (!this.rhinoElement) {
      debugDefinedLinks("_decorateLinkDialog skipped: rhino element missing");
      return;
    }
    const { shadowRoot } = this.rhinoElement;
    if (!shadowRoot) {
      if (!this._loggedMissingShadowRoot) {
        debugDefinedLinks("Rhino shadow root not yet available");
        this._loggedMissingShadowRoot = true;
      }
      return;
    }

    if (this._loggedMissingShadowRoot) {
      debugDefinedLinks("Rhino shadow root ready");
      this._loggedMissingShadowRoot = false;
    }

    const definedLinksUrl = this.textarea.dataset.definedLinksUrl;
    const definedFilesUrl = this.textarea.dataset.definedFilesUrl;
    const fileUploadUrl = this.textarea.dataset.fileUploadUrl;

    if (!definedLinksUrl && !definedFilesUrl) {
      if (!this._loggedMissingDefinedLinksUrl) {
        debugDefinedLinks("Textarea missing defined-links/files URLs; picker disabled");
        this._loggedMissingDefinedLinksUrl = true;
      }
      if (this._definedLinksPicker) {
        this._definedLinksPicker.destroy();
        this._definedLinksPicker = null;
      }
      return;
    }

    if (this._loggedMissingDefinedLinksUrl) {
      debugDefinedLinks("Defined-links/files URL discovered", { definedLinksUrl, definedFilesUrl });
      this._loggedMissingDefinedLinksUrl = false;
    }

    // Use combined picker if we have both pages and files URLs
    const pickerKey = `${definedLinksUrl || ''}:${definedFilesUrl || ''}`;
    const currentPickerKey = this._definedLinksPicker?._pickerKey;

    if (!this._definedLinksPicker || currentPickerKey !== pickerKey) {
      debugDefinedLinks("Preparing unified picker", { definedLinksUrl, definedFilesUrl });
      
      if (this._definedLinksPicker) {
        this._definedLinksPicker.destroy();
      }

      if (definedLinksUrl && definedFilesUrl) {
        // Use combined picker for both pages and files
        this._definedLinksPicker = new DefinedFilesPicker(
          this,
          definedLinksUrl,
          definedFilesUrl,
          fileUploadUrl
        );
        this._definedLinksPicker._pickerKey = pickerKey;
      } else {
        // Fallback to single picker if only one URL is available
        const url = definedLinksUrl || definedFilesUrl;
        this._definedLinksPicker = new DefinedLinksPicker(
          this,
          url
        );
        this._definedLinksPicker._pickerKey = pickerKey;
      }
    } else {
      debugDefinedLinks("Unified picker already configured", { pickerKey });
    }

    this._definedLinksPicker.observe(shadowRoot);
    this._setupSourceToggle();
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
   * Set up image resize controls in toolbar
   */
  _setupImageResizeControls() {
    if (!this.rhinoElement) return;

    // Create reset button
    if (!this._imageResetButton) {
      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "toolbar__button rhino-toolbar-button cms-image-reset";
      resetButton.setAttribute("slot", "toolbar-end");
      resetButton.setAttribute("part", "toolbar__button toolbar__button--image-reset cms-image-reset");
      resetButton.setAttribute("title", "Reset image to original size");
      resetButton.setAttribute("aria-label", "Reset image to original size");
      resetButton.style.display = "none"; // Hidden by default
      resetButton.innerHTML = `
        <span class="cms-image-reset__icon" aria-hidden="true">↻</span>
        <span class="cms-image-reset__label">Reset</span>
      `;
      resetButton.addEventListener("click", this._boundImageReset);
      this._imageResetButton = resetButton;
    }

    // Create aspect ratio toggle button
    if (!this._imageAspectRatioButton) {
      const aspectButton = document.createElement("button");
      aspectButton.type = "button";
      aspectButton.className = "toolbar__button rhino-toolbar-button cms-image-aspect-ratio";
      aspectButton.setAttribute("slot", "toolbar-end");
      aspectButton.setAttribute("part", "toolbar__button toolbar__button--image-aspect-ratio cms-image-aspect-ratio");
      aspectButton.setAttribute("aria-pressed", "true"); // Default: locked
      aspectButton.setAttribute("title", "Toggle aspect ratio lock");
      aspectButton.setAttribute("aria-label", "Toggle aspect ratio lock");
      aspectButton.style.display = "none"; // Hidden by default
      aspectButton.innerHTML = `
        <span class="cms-image-aspect-ratio__icon" aria-hidden="true">🔒</span>
        <span class="cms-image-aspect-ratio__label">Lock</span>
      `;
      aspectButton.addEventListener("click", this._boundImageAspectRatioToggle);
      this._imageAspectRatioButton = aspectButton;
    }

    // Append buttons to toolbar
    if (this._imageResetButton && !this._imageResetButton.isConnected) {
      this.rhinoElement.appendChild(this._imageResetButton);
    }
    if (this._imageAspectRatioButton && !this._imageAspectRatioButton.isConnected) {
      this.rhinoElement.appendChild(this._imageAspectRatioButton);
    }

    // Listen for selection changes to show/hide controls
    this.editor.on('selectionUpdate', () => {
      this._updateImageResizeControlsVisibility();
    });
  }

  /**
   * Update visibility of image resize controls based on selection
   */
  _updateImageResizeControlsVisibility() {
    if (!this.editor || !this._imageResetButton || !this._imageAspectRatioButton) return;

    const { selection } = this.editor.state;
    const node = this.editor.state.doc.nodeAt(selection.from);
    const isImageSelected = node && node.type.name === 'image';

    // Show/hide buttons based on selection
    this._imageResetButton.style.display = isImageSelected ? '' : 'none';
    this._imageAspectRatioButton.style.display = isImageSelected ? '' : 'none';

    // Update aspect ratio button state
    if (isImageSelected && node.attrs.aspectRatioLocked !== undefined) {
      const isLocked = node.attrs.aspectRatioLocked !== false;
      this._imageAspectRatioButton.setAttribute('aria-pressed', isLocked ? 'true' : 'false');
      this._imageAspectRatioButton.classList.toggle('is-active', isLocked);

      const icon = this._imageAspectRatioButton.querySelector('.cms-image-aspect-ratio__icon');
      const label = this._imageAspectRatioButton.querySelector('.cms-image-aspect-ratio__label');
      if (icon) icon.textContent = isLocked ? '🔒' : '🔓';
      if (label) label.textContent = isLocked ? 'Lock' : 'Unlock';
    }
  }

  /**
   * Handle reset button click
   */
  _handleImageReset(event) {
    event?.preventDefault?.();
    if (!this.editor) return;

    this.editor.commands.resetImageSize();
    this.editor.commands.focus();
  }

  /**
   * Handle aspect ratio toggle button click
   */
  _handleImageAspectRatioToggle(event) {
    event?.preventDefault?.();
    if (!this.editor) return;

    this.editor.commands.toggleImageAspectRatio();
    this._updateImageResizeControlsVisibility();
    this.editor.commands.focus();
  }

  _setupTableControls() {
    if (!this.rhinoElement || !this.editor) return;

    if (!this._tableInsertButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toolbar__button rhino-toolbar-button cms-table-insert";
      button.setAttribute("slot", "toolbar-end");
      button.setAttribute(
        "part",
        "toolbar__button toolbar__button--table cms-table-insert"
      );
      button.setAttribute("title", "Insert table");
      button.setAttribute("aria-label", "Insert table");
      button.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.className = "cms-table-insert__label";
      label.textContent = "Table";
      button.appendChild(label);
      button.addEventListener("click", this._boundTableInsert);
      this._tableInsertButton = button;
    }

    if (!this._tableMenu) {
  const menu = document.createElement("role-toolbar");
  menu.className = "toolbar cms-table-toolbar";
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("part", "toolbar cms-table-toolbar");
  menu.setAttribute("slot", "toolbar-end");
  menu.setAttribute("aria-label", "Table tools");
      menu.hidden = true;
      menu.setAttribute("aria-hidden", "true");
      menu.addEventListener("click", this._boundTableMenuClick);

      this._tableActionButtons.clear();
      for (const action of TABLE_ACTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "toolbar__button rhino-toolbar-button cms-table-toolbar__button";
        button.dataset.tableAction = action.key;
        button.textContent = action.label;
        button.setAttribute("title", action.label);
        button.setAttribute("aria-label", action.label);
        button.setAttribute("data-role", "toolbar-item");
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        menu.appendChild(button);
        this._tableActionButtons.set(action.key, button);
      }

      this._tableMenu = menu;
    }

    if (this._tableInsertButton && !this._tableInsertButton.isConnected) {
      this.rhinoElement.appendChild(this._tableInsertButton);
    }

    if (this._tableMenu && !this._tableMenu.isConnected) {
      this.rhinoElement.appendChild(this._tableMenu);
    }

    if (!this._tableSelectionUnsubscribe && this.editor.on) {
      this._tableSelectionUnsubscribe = this.editor.on(
        "selectionUpdate",
        this._boundTableUpdate
      );
    }

    if (!this._tableTransactionUnsubscribe && this.editor.on) {
      this._tableTransactionUnsubscribe = this.editor.on(
        "transaction",
        this._boundTableUpdate
      );
    }

    this._updateTableControls();
  }

  _updateTableControls() {
    const editor = this.editor;
    const canInsert = canRunEditorCommand(editor, "insertTable", TABLE_INSERT_DEFAULTS);

    if (this._tableInsertButton) {
      this._tableInsertButton.disabled = !canInsert;
      this._tableInsertButton.setAttribute(
        "aria-disabled",
        canInsert ? "false" : "true"
      );
    }

    if (!this._tableMenu) return;

    const isInTable = Boolean(
      editor && typeof editor.isActive === "function" && editor.isActive("table")
    );

    this._tableMenu.hidden = !isInTable;
    this._tableMenu.setAttribute("aria-hidden", isInTable ? "false" : "true");

    if (!isInTable) {
      for (const button of this._tableActionButtons.values()) {
        if (!button) continue;
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      return;
    }

    for (const [key, button] of this._tableActionButtons) {
      if (!button) continue;
      const action = TABLE_ACTION_LOOKUP.get(key);
      if (!action) continue;
      const canRun = canRunEditorCommand(editor, action.command, action.args);
      button.disabled = !canRun;
      button.setAttribute("aria-disabled", canRun ? "false" : "true");
    }
  }

  _handleTableInsert(event) {
    event?.preventDefault?.();
    const didInsert = runEditorCommand(
      this.editor,
      "insertTable",
      TABLE_INSERT_DEFAULTS
    );
    if (didInsert) {
      this._updateTableControls();
    }
  }

  _handleTableMenuClick(event) {
    const target = event.target instanceof Element
      ? event.target.closest("[data-table-action]")
      : null;
    if (!target) return;
    if (target.hasAttribute("disabled")) return;
    event.preventDefault();

    const action = TABLE_ACTION_LOOKUP.get(target.dataset.tableAction || "");
    if (!action) return;

    const didRun = runEditorCommand(this.editor, action.command, action.args);
    if (didRun) {
      this._updateTableControls();
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
      this.rhinoElement.removeEventListener("rhino-update", this._boundRhinoUpdate);
      this.rhinoElement.remove();
    }
    if (this.textarea) {
      this.textarea.style.display = "";
    }
    if (this._definedLinksPicker) {
      this._definedLinksPicker.destroy();
      this._definedLinksPicker = null;
    }
    if (this._tocToggleButton) {
      this._tocToggleButton.removeEventListener("click", this._boundTocToggle);
      this._tocToggleButton.remove();
      this._tocToggleButton = null;
    }
    if (this._imageResetButton) {
      this._imageResetButton.removeEventListener("click", this._boundImageReset);
      this._imageResetButton.remove();
      this._imageResetButton = null;
    }
    if (this._imageAspectRatioButton) {
      this._imageAspectRatioButton.removeEventListener("click", this._boundImageAspectRatioToggle);
      this._imageAspectRatioButton.remove();
      this._imageAspectRatioButton = null;
    }
    if (this._tableSelectionUnsubscribe) {
      this._tableSelectionUnsubscribe();
      this._tableSelectionUnsubscribe = null;
    }
    if (this._tableTransactionUnsubscribe) {
      this._tableTransactionUnsubscribe();
      this._tableTransactionUnsubscribe = null;
    }
    if (this._tableInsertButton) {
      this._tableInsertButton.removeEventListener("click", this._boundTableInsert);
      this._tableInsertButton.remove();
      this._tableInsertButton = null;
    }
    if (this._tableMenu) {
      this._tableMenu.removeEventListener("click", this._boundTableMenuClick);
      this._tableMenu.remove();
      this._tableMenu = null;
    }
    this._tableActionButtons.clear();
    this._destroySourceDialog();
    this.editor = null;
    this.rhinoElement = null;
    this._tocItems = [];
    this._lastRenderedTocItems = "[]";
  }

  _handleRhinoUpdate() {
    this._replaceAttachmentFiguresWithImages();
  }

  _parseDimension(value) {
    if (value == null || value === "") return null;
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : null;
  }

  _replaceAttachmentFiguresWithImages() {
    if (this._isReplacingAttachments) return;
    if (!this.editor) return;

    const { state, schema, view } = this.editor;
    if (!schema?.nodes?.image) return;

    const attachmentTypes = new Set(["attachment-figure", "previewable-attachment-figure"]);
    let tr = state.tr;
    let modified = false;

    this._isReplacingAttachments = true;

    try {
      state.doc.descendants((node, pos) => {
        if (!attachmentTypes.has(node.type.name)) {
          return;
        }

        const contentType = node.attrs?.contentType || "";
        const isImageType = typeof contentType === "string" && contentType.startsWith("image/");

        const candidateSources = [node.attrs?.url, node.attrs?.src].filter((value) => typeof value === "string");
        const resolvedSrc = candidateSources.find((value) => {
          if (!value) return false;
          const trimmed = value.trim();
          if (!trimmed) return false;
          if (trimmed.startsWith("blob:")) return false;
          return true;
        });

        if (!resolvedSrc) {
          return;
        }

        if (!isImageType && !node.attrs?.previewable) {
          return;
        }

        const width = this._parseDimension(node.attrs?.width);
        const height = this._parseDimension(node.attrs?.height);

        const imageNode = schema.nodes.image.create({
          src: resolvedSrc,
          alt: node.attrs?.alt || "",
          width,
          height,
          originalWidth: width,
          originalHeight: height,
          aspectRatioLocked: true,
        });

        tr = tr.replaceWith(pos, pos + node.nodeSize, imageNode);
        modified = true;

        return false;
      });

      if (modified) {
        tr.setMeta("addToHistory", false);
        view.dispatch(tr);
      }
    } finally {
      this._isReplacingAttachments = false;
    }
  }

  _setupSourceToggle() {
    if (!this.rhinoElement) return;

    if (!this._sourceButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toolbar__button rhino-toolbar-button cms-source-toggle";
      button.setAttribute("slot", "toolbar-end");
      button.setAttribute(
        "part",
        "toolbar__button toolbar__button--source cms-source-toggle"
      );
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("title", "HTML");
      button.setAttribute("aria-label", "Edit HTML source");
      button.innerHTML = `
        <span class="cms-source-toggle__label">HTML</span>
      `;
      button.addEventListener("click", this._boundSourceToggle);
      this._sourceButton = button;
    }

    if (this._sourceButton && !this._sourceButton.isConnected) {
      this.rhinoElement.appendChild(this._sourceButton);
    }

    if (!this._sourceDialog) {
      this._buildSourceDialog();
    }
  }

  _setupTocToggle() {
    if (!this.rhinoElement) return;

    if (!this._tocToggleButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toolbar__button rhino-toolbar-button cms-toc-toggle";
      button.setAttribute("slot", "toolbar-end");
      button.setAttribute(
        "part",
        "toolbar__button toolbar__button--toc cms-toc-toggle"
      );
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("title", "Toggle table of contents");
      button.setAttribute("aria-label", "Toggle table of contents");
      button.innerHTML = `
        <span class="cms-toc-toggle__icon" aria-hidden="true">☰</span>
        <span class="cms-toc-toggle__label">ToC</span>
      `;
      button.addEventListener("click", this._boundTocToggle);
      this._tocToggleButton = button;
    }

    if (this._tocToggleButton && !this._tocToggleButton.isConnected) {
      this.rhinoElement.appendChild(this._tocToggleButton);
    }

    this._updateTocButtonState();
  }

  _handleTocToggle(event) {
    event?.preventDefault?.();
    if (!this.editor) return;

    const existing = this._findTocNode();
    if (existing) {
      this.editor.chain().focus().deleteRange({
        from: existing.pos,
        to: existing.pos + existing.node.nodeSize
      }).run();
      this._updateTocButtonState();
      return;
    }

    const tocType = this.editor.schema?.nodes?.cmsTableOfContents;
    if (!tocType) return;

    const attrs = {
      items: this._lastRenderedTocItems || "[]"
    };

    const { tr } = this.editor.state;
    tr.insert(0, tocType.create(attrs));
    tr.setMeta("toc", true);
    this.editor.view.dispatch(tr);

    if (typeof this.editor.commands.updateTableOfContents === "function") {
      this.editor.commands.updateTableOfContents();
    }

    this._updateTocButtonState();
  }

  _updateTocButtonState() {
    if (!this._tocToggleButton) return;

    const hasNode = this._hasTocNode();
    this._tocToggleButton.setAttribute("aria-pressed", hasNode ? "true" : "false");
    this._tocToggleButton.classList.toggle("is-active", hasNode);

    const hasHeadings = Array.isArray(this._tocItems) && this._tocItems.length > 0;
    this._tocToggleButton.toggleAttribute("data-empty", !hasHeadings);
    this._tocToggleButton.disabled = false;
    this._tocToggleButton.setAttribute("aria-disabled", "false");

    if (!hasHeadings && !hasNode) {
      this._tocToggleButton.setAttribute(
        "title",
        "Add headings to generate a table of contents"
      );
    } else {
      this._tocToggleButton.setAttribute("title", hasNode ? "Remove table of contents" : "Insert table of contents");
    }

    const label = this._tocToggleButton.getAttribute("title") || "Toggle table of contents";
    this._tocToggleButton.setAttribute("aria-label", label);
  }

  _hasTocNode() {
    return Boolean(this._findTocNode());
  }

  _findTocNode() {
    if (!this.editor) return null;
    const tocType = this.editor.schema?.nodes?.cmsTableOfContents;
    if (!tocType) return null;

    let result = null;
    this.editor.state.doc.descendants((node, pos) => {
      if (result) return false;
      if (node.type === tocType) {
        result = { node, pos };
        return false;
      }
      return true;
    });
    return result;
  }

  _handleTocUpdate(rawItems = []) {
    const normalized = this._normalizeTocItems(rawItems);
    this._tocItems = normalized;
    const serialized = JSON.stringify(normalized);

    if (serialized !== this._lastRenderedTocItems) {
      this._lastRenderedTocItems = serialized;
      this._syncTocNode(serialized);
    }

    this._updateTocButtonState();
  }

  _normalizeTocItems(rawItems) {
    if (!Array.isArray(rawItems)) return [];

    const roots = [];
    const stack = [];

    rawItems.forEach((raw) => {
      if (!raw || typeof raw !== "object") return;

      const hierarchicalLevel = Number.isInteger(raw.level) ? raw.level : 1;
      const actualLevel = Number.isInteger(raw.originalLevel)
        ? raw.originalLevel
        : hierarchicalLevel;
      const depth = Math.max(1, hierarchicalLevel);
      const item = {
        id: typeof raw.id === "string" && raw.id.length ? raw.id : null,
        text: (raw.textContent || "").trim() || "Untitled section",
        level: Math.max(1, actualLevel || 1),
        depth,
        isActive: Boolean(raw.isActive),
        isScrolled: Boolean(raw.isScrolledOver || raw.isScrolled),
        children: []
      };

      while (stack.length && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(item);
      } else {
        stack[stack.length - 1].children.push(item);
      }

      stack.push(item);
    });

    return roots;
  }

  _syncTocNode(serializedItems = "[]") {
    if (!this.editor) return;

    const tocEntry = this._findTocNode();
    if (!tocEntry) return;

    const { node, pos } = tocEntry;
    if (node.attrs?.items === serializedItems) return;

    const attrs = { ...node.attrs, items: serializedItems };
    const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, attrs);
    tr.setMeta("toc", true);
    tr.setMeta("addToHistory", false);
    this.editor.view.dispatch(tr);
  }

  _ensureSourceEditor() {
    if (!this._sourceTextarea || this._sourceEditor) return;

    this._sourceEditor = CodeMirror.fromTextArea(this._sourceTextarea, {
      mode: "htmlmixed",
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      autoCloseTags: true,
      autoCloseBrackets: true,
      matchTags: { bothTags: true },
      styleActiveLine: true,
      viewportMargin: Infinity,
      extraKeys: {
        Tab: (cm) => cm.execCommand("insertSoftTab"),
        "Shift-Tab": (cm) => cm.execCommand("indentLess"),
        "Ctrl-Enter": () => this._handleSourceApply(),
        "Cmd-Enter": () => this._handleSourceApply(),
        "Ctrl-S": () => this._handleSourceApply(),
        "Cmd-S": () => this._handleSourceApply(),
        Esc: () => this._closeSourceDialog()
      }
    });

    const wrapper = this._sourceEditor.getWrapperElement();
    if (wrapper) {
      wrapper.classList.add("cms-source-dialog__codemirror");
      wrapper.setAttribute("role", "textbox");
      wrapper.setAttribute("aria-label", "Raw HTML content");
      wrapper.setAttribute("aria-multiline", "true");
      wrapper.setAttribute("tabindex", "0");
    }

    this._sourceEditor.on("keydown", (cm, event) => {
      if ((event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === "enter") {
        event.preventDefault();
        this._handleSourceApply(event);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this._closeSourceDialog();
      }
    });

    requestAnimationFrame(() => {
      this._sourceEditor?.refresh();
    });
  }

  _focusSourceEditor({ toDocumentEnd = true } = {}) {
    if (this._sourceEditor) {
      const doc = this._sourceEditor.getDoc();
      if (toDocumentEnd) {
        const lastLine = doc.lastLine();
        const lastCh = doc.getLine(lastLine).length;
        doc.setCursor({ line: lastLine, ch: lastCh });
      }
      this._sourceEditor.focus();
      return;
    }

    if (this._sourceTextarea) {
      const length = this._sourceTextarea.value.length;
      this._sourceTextarea.focus();
      this._sourceTextarea.setSelectionRange(length, length);
    }
  }

  _getSourceContent() {
    if (this._sourceEditor) {
      return this._sourceEditor.getValue();
    }
    return this._sourceTextarea?.value ?? "";
  }

  _formatHtml(html) {
    const raw = typeof html === "string" ? html : "";
    if (!raw.trim()) {
      return raw;
    }

    try {
      return beautifyHtml(raw, HTML_FORMAT_OPTIONS);
    } catch (error) {
      console.error("CMS HTML formatting failed", error);
      return raw;
    }
  }

  _buildSourceDialog() {
    const dialogId = `cms-source-dialog-${this._sourceDialogKey}`;
    const titleId = `${dialogId}-title`;

    const dialog = document.createElement("div");
    dialog.className = "cms-source-dialog";
    dialog.hidden = true;
    dialog.setAttribute("aria-hidden", "true");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-labelledby", titleId);

    const backdrop = document.createElement("div");
    backdrop.className = "cms-source-dialog__backdrop";
    backdrop.addEventListener("click", this._boundSourceCancel);

    const surface = document.createElement("div");
    surface.className = "cms-source-dialog__surface";
    surface.setAttribute("role", "document");

    const header = document.createElement("header");
    header.className = "cms-source-dialog__header";

    const title = document.createElement("h2");
    title.className = "cms-source-dialog__title";
    title.id = titleId;
    title.textContent = "HTML source";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "cms-source-dialog__close";
    closeButton.setAttribute("aria-label", "Close HTML source editor");
    closeButton.innerHTML = "×";
    closeButton.addEventListener("click", this._boundSourceCancel);

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "cms-source-dialog__body";

    const textarea = document.createElement("textarea");
    textarea.className = "cms-source-dialog__textarea";
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Raw HTML content");

    body.appendChild(textarea);

    const footer = document.createElement("footer");
    footer.className = "cms-source-dialog__footer";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "cms-source-dialog__button cms-source-dialog__button--cancel";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", this._boundSourceCancel);

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "cms-source-dialog__button cms-source-dialog__button--apply";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", this._boundSourceApply);

    footer.append(cancelButton, applyButton);

    surface.append(header, body, footer);
    dialog.append(backdrop, surface);
    dialog.addEventListener("keydown", this._boundSourceKeydown);

    (document.body || document.documentElement).appendChild(dialog);

    this._sourceDialog = dialog;
    this._sourceTextarea = textarea;
    this._sourceApplyButton = applyButton;
    this._sourceCancelButton = cancelButton;
    this._sourceCloseButton = closeButton;
    this._sourceBackdrop = backdrop;
  }

  _handleSourceToggle() {
    if (this._isSourceDialogOpen) {
      this._closeSourceDialog();
    } else {
      this._openSourceDialog();
    }
  }

  _openSourceDialog() {
    if (!this._sourceDialog || !this._sourceTextarea) {
      this._buildSourceDialog();
    }
    if (!this._sourceDialog || !this._sourceTextarea) return;

    this._ensureSourceEditor();

    const currentHtml = this.getHtml();
    const formattedHtml = this._formatHtml(currentHtml);
    const htmlForEditor = formattedHtml || currentHtml;
    if (this._sourceEditor) {
      const doc = this._sourceEditor.getDoc();
      const cursor = doc.getCursor();
      doc.setValue(htmlForEditor);
      const lastLine = doc.lastLine();
      const lastCh = doc.getLine(lastLine).length;
      doc.setCursor(cursor && typeof cursor.line === "number" ? cursor : { line: lastLine, ch: lastCh });
      this._sourceEditor.refresh();
    } else {
      this._sourceTextarea.value = htmlForEditor;
    }

    this._sourceDialog.hidden = false;
    this._sourceDialog.setAttribute("aria-hidden", "false");
    this._sourceDialog.classList.add("is-open");
    this._isSourceDialogOpen = true;
    this._updateSourceButtonState(true);

    if (document?.body) {
      this._previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const editorWrapper = this._sourceEditor?.getWrapperElement();
    this._sourceFocusables = [
      editorWrapper,
      this._sourceCancelButton,
      this._sourceApplyButton,
      this._sourceCloseButton
    ].filter((element) => element instanceof HTMLElement);

    this._lastFocusedElement = document.activeElement;
    requestAnimationFrame(() => {
      this._focusSourceEditor();
    });
  }

  _closeSourceDialog({ restoreFocus = true } = {}) {
    if (!this._sourceDialog) return;
    this._sourceDialog.hidden = true;
    this._sourceDialog.setAttribute("aria-hidden", "true");
    this._sourceDialog.classList.remove("is-open");
    this._isSourceDialogOpen = false;
    this._updateSourceButtonState(false);
    this._sourceFocusables = [];

    if (document?.body && this._previousBodyOverflow !== null) {
      document.body.style.overflow = this._previousBodyOverflow;
      this._previousBodyOverflow = null;
    }

    if (restoreFocus && this._lastFocusedElement instanceof HTMLElement) {
      requestAnimationFrame(() => {
        this._lastFocusedElement?.focus?.();
      });
    }
  }

  _handleSourceApply(event) {
    event?.preventDefault?.();
    const rawHtml = this._getSourceContent();
    const nextHtml = this._formatHtml(rawHtml);
    this.setHtml(nextHtml);
    this.focus();
    this._closeSourceDialog();
  }

  _handleSourceCancel(event) {
    event?.preventDefault?.();
    this._closeSourceDialog();
  }

  _handleSourceKeydown(event) {
    if (!this._isSourceDialogOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this._closeSourceDialog();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === "enter") {
      event.preventDefault();
      this._handleSourceApply(event);
      return;
    }

    if (event.key === "Tab" && this._sourceFocusables.length) {
      const focusables = this._sourceFocusables.filter(
        (element) =>
          element instanceof HTMLElement && !element.hasAttribute("disabled")
      );
      if (!focusables.length) return;
      const activeElement = document.activeElement;
      let currentIndex = focusables.indexOf(activeElement);
      if (currentIndex === -1) {
        currentIndex = event.shiftKey ? 0 : focusables.length - 1;
      }
      let nextIndex = currentIndex;
      if (event.shiftKey) {
        nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1;
      }
      event.preventDefault();
      const nextElement = focusables[nextIndex];
      if (this._sourceEditor && nextElement === this._sourceEditor.getWrapperElement()) {
        this._focusSourceEditor({ toDocumentEnd: false });
      } else {
        nextElement?.focus?.();
      }
    }
  }

  _updateSourceButtonState(isOpen) {
    if (!this._sourceButton) return;
    this._sourceButton.setAttribute("aria-pressed", isOpen ? "true" : "false");
    this._sourceButton.classList.toggle("is-active", Boolean(isOpen));
    this._sourceButton.classList.toggle(
      "toolbar__button--active",
      Boolean(isOpen)
    );
  }

  _destroySourceDialog() {
    if (this._sourceButton) {
      this._sourceButton.removeEventListener("click", this._boundSourceToggle);
      if (this._sourceButton.isConnected) {
        this._sourceButton.remove();
      }
      this._sourceButton = null;
    }

    if (this._isSourceDialogOpen) {
      this._closeSourceDialog({ restoreFocus: false });
    } else if (document?.body && this._previousBodyOverflow !== null) {
      document.body.style.overflow = this._previousBodyOverflow;
      this._previousBodyOverflow = null;
    }

    if (!this._sourceDialog) return;

    this._sourceDialog.removeEventListener("keydown", this._boundSourceKeydown);
    if (this._sourceBackdrop) {
      this._sourceBackdrop.removeEventListener("click", this._boundSourceCancel);
    }
    if (this._sourceCancelButton) {
      this._sourceCancelButton.removeEventListener("click", this._boundSourceCancel);
    }
    if (this._sourceApplyButton) {
      this._sourceApplyButton.removeEventListener("click", this._boundSourceApply);
    }
    if (this._sourceCloseButton) {
      this._sourceCloseButton.removeEventListener("click", this._boundSourceCancel);
    }

    if (this._sourceEditor) {
      this._sourceEditor.toTextArea();
      this._sourceEditor = null;
    }

    if (this._sourceDialog.isConnected) {
      this._sourceDialog.remove();
    }

    this._sourceDialog = null;
    this._sourceTextarea = null;
    this._sourceCancelButton = null;
    this._sourceApplyButton = null;
    this._sourceCloseButton = null;
    this._sourceBackdrop = null;
    this._sourceFocusables = [];
    this._isSourceDialogOpen = false;
    this._lastFocusedElement = null;
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
