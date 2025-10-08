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
import CmsTableOfContentsNode from "./extensions/table_of_contents";
import IframeExtension from "./extensions/iframe";

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
      label.textContent = "Link to a CMS page";
  label.setAttribute("part", "cms-defined-links__label");

      this.list = document.createElement("ul");
      this.list.className = "cms-defined-links__results";
      this.list.setAttribute("role", "listbox");
      this.list.id = "cms-defined-links-results";
      this.list.setAttribute("aria-label", "CMS pages suggestions");
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
      `Enter URL or search CMS pages`
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
        this.createStatusItem("Unable to load CMS pages")
      );
      return;
    }

    if (!this.links.length) {
      if (this.isFetching) {
        debugDefinedLinks("Awaiting fetch results");
        this.list.appendChild(this.createStatusItem("Loading pages…"));
      } else {
        debugDefinedLinks("No pages available after fetch");
        this.list.appendChild(this.createStatusItem("No pages available"));
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
        ? "No matching pages"
        : "No pages available";
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

      const name = document.createElement("span");
      name.className = "cms-defined-links__option-name";
      name.textContent = option.name;
      name.setAttribute("part", "cms-defined-links__option-name");

      const url = document.createElement("span");
      url.className = "cms-defined-links__option-url";
      url.textContent = option.url;
      url.setAttribute("part", "cms-defined-links__option-url");

      item.append(name, url);
      this.list.appendChild(item);
    });

    if (this.highlightedIndex >= matches.length) {
      this.highlightedIndex = -1;
    }
    debugDefinedLinks("Rendered options", { count: matches.length });
    this.renderHighlight();
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
  }

  /**
   * Initialize the Rhino Editor on the textarea
   */
  mount() {
    // Create rhino-editor element
    this.rhinoElement = document.createElement("rhino-editor");

    const tableOfContentsExtension = TableOfContents.configure({
      onUpdate: (items = []) => {
        this._handleTocUpdate(items);
      }
    });

    this.rhinoElement.addExtensions(
      IframeExtension,
      tableOfContentsExtension,
      CmsTableOfContentsNode
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

    if (!definedLinksUrl) {
      if (!this._loggedMissingDefinedLinksUrl) {
        debugDefinedLinks("Textarea missing defined-links URL; picker disabled");
        this._loggedMissingDefinedLinksUrl = true;
      }
      if (this._definedLinksPicker) {
        this._definedLinksPicker.destroy();
        this._definedLinksPicker = null;
      }
      return;
    }

    if (this._loggedMissingDefinedLinksUrl) {
      debugDefinedLinks("Defined-links URL discovered", { definedLinksUrl });
      this._loggedMissingDefinedLinksUrl = false;
    }

    if (!this._definedLinksPicker || this._definedLinksPicker.url !== definedLinksUrl) {
      debugDefinedLinks("Preparing defined-links picker", { definedLinksUrl });
    } else {
      debugDefinedLinks("Defined-links picker already matches URL", { definedLinksUrl });
    }

    if (!this._definedLinksPicker) {
      this._definedLinksPicker = new DefinedLinksPicker(
        this,
        definedLinksUrl
      );
    } else if (this._definedLinksPicker.url !== definedLinksUrl) {
      this._definedLinksPicker.destroy();
      this._definedLinksPicker = new DefinedLinksPicker(
        this,
        definedLinksUrl
      );
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
    if (this._definedLinksPicker) {
      this._definedLinksPicker.destroy();
      this._definedLinksPicker = null;
    }
    if (this._tocToggleButton) {
      this._tocToggleButton.removeEventListener("click", this._boundTocToggle);
      this._tocToggleButton.remove();
      this._tocToggleButton = null;
    }
    this._destroySourceDialog();
    this.editor = null;
    this.rhinoElement = null;
    this._tocItems = [];
    this._lastRenderedTocItems = "[]";
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
