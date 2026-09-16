import jQuery from "jquery";
import Popover from "bootstrap/js/src/popover";

(() => {
  const isFirefox = /\bFirefox\//.test(navigator.userAgent);

  class FileLink {
    constructor(link) {
      this.link = link;
      this.isImage = !!link.dataset.cmsFileThumbUrl;
      this.cleanupFns = [];
      this.on("dragstart", (evt) => {
        evt.dataTransfer.setData(
          "text/plain",
          this.link.dataset.cmsFileLinkTag
        );
      });

      if (this.isImage) {
        new Popover(link, {
          container: link.parentElement,
          trigger: "hover",
          placement: "top",
          content: this.buildFileThumbnail(),
          html: true,
        });

        this.on("dragstart", (evt) => {
          evt.dataTransfer.setDragImage(this.buildFileThumbnail(), 4, 2);
          this.getPopover()?.hide();
        });

        this.workAroundFirefoxPopoverGlitch();
      }
    }

    destroy() {
      for (const cleanupFn of this.cleanupFns.splice(0)) {
        cleanupFn();
      }
      this.getPopover()?.dispose();
    }

    on(eventName, handler) {
      this.link.addEventListener(eventName, handler);
      this.cleanupFns.push(() => {
        this.link.removeEventListener(eventName, handler);
      });
    }

    buildFileThumbnail() {
      const img = new Image();
      img.src = this.link.dataset.cmsFileThumbUrl;
      return img;
    }

    // To work around a Firefox bug causing the popover to re-appear after the drop:
    // https://github.com/comfy/comfortable-mexican-sofa/pull/799#issuecomment-369124161
    //
    // Possibly related to:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=505521
    workAroundFirefoxPopoverGlitch() {
      if (!isFirefox) return;
      this.on("dragstart", () => {
        this.getPopover()?.disable();
      });
      this.on("dragend", () => {
        setTimeout(() => {
          const popover = this.getPopover();
          popover?.enable();
          popover?.hide();
        }, 300);
      });
    }

    // We can't keep a reference to the Popover object, because Bootstrap re-creates it internally.
    getPopover() {
      return jQuery(this.link).data(Popover.DATA_KEY);
    }
  }

  const fileLinks = new Map();
  const initFileLinks = (root = document) => {
    for (const link of root.querySelectorAll("[data-cms-file-link-tag]")) {
      if (!fileLinks.has(link)) fileLinks.set(link, new FileLink(link));
    }
  };
  initFileLinks.dispose = (root = null) => {
    for (const [link, fileLink] of fileLinks) {
      if (root !== null && link !== root && !root.contains(link)) continue;
      fileLink.destroy();
      fileLinks.delete(link);
    }
  };
  window.CMS.fileLinks = initFileLinks;
})();
