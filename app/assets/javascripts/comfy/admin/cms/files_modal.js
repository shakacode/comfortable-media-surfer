import Modal from "bootstrap/js/src/modal";

// Site files modal.
(() => {
  let modal = null;
  let modalToggle = null;
  let modalContainer = null;
  let modalContent = null;
  let onModalToggle = null;
  let onModalContentDragStart = null;
  let requestId = 0;

  const initModalContent = () => {
    window.CMS.fileUpload.init(modalContent);
    window.CMS.fileLinks(modalContent);
  };

  const dispose = () => {
    requestId += 1;
    if (modalToggle !== null && onModalToggle !== null) {
      modalToggle.removeEventListener("click", onModalToggle);
    }
    if (modalContent !== null && onModalContentDragStart !== null) {
      modalContent.removeEventListener("dragstart", onModalContentDragStart);
      window.CMS.fileUpload.dispose(modalContent);
      window.CMS.fileLinks.dispose(modalContent);
    }
    if (modal !== null) {
      const wasAnimated = modalContainer.classList.contains("fade");
      modalContainer.classList.remove("fade");
      modal.hide();
      if (wasAnimated) modalContainer.classList.add("fade");
      modal.dispose();
    }
    modal = null;
    modalToggle = null;
    modalContainer = null;
    modalContent = null;
    onModalToggle = null;
    onModalContentDragStart = null;
  };

  window.CMS.files = {
    init() {
      const nextModalToggle = document.querySelector(".cms-files-open-modal");
      const nextModalContainer = document.querySelector(".cms-files-modal");
      if (nextModalToggle === null || nextModalContainer === null) return;
      if (
        modalToggle === nextModalToggle &&
        modalContainer === nextModalContainer
      ) {
        return;
      }

      dispose();
      modalToggle = nextModalToggle;
      modalContainer = nextModalContainer;
      modalContent = modalContainer.querySelector(".modal-content");
      onModalContentDragStart = (evt) => {
        if (
          evt.target.nodeType === Node.ELEMENT_NODE &&
          evt.target.matches(".cms-uploader-filelist .item-title a") &&
          modal !== null
        ) {
          modal.hide();
        }
      };
      modalContent.addEventListener("dragstart", onModalContentDragStart);
      onModalToggle = (evt) => {
        evt.preventDefault();
        const currentRequestId = ++requestId;
        const currentModalContent = modalContent;
        const url = new URL(modalContainer.dataset.url, document.location.href);
        url.username = "";
        url.password = "";
        fetch(url, { credentials: "same-origin" })
          .then((resp) => resp.text())
          .then((html) => {
            if (
              currentRequestId !== requestId ||
              currentModalContent !== modalContent
            ) {
              return;
            }
            window.CMS.fileUpload.dispose(modalContent);
            window.CMS.fileLinks.dispose(modalContent);
            modalContent.innerHTML = `<div class="modal-body">${html}</div>`;
            initModalContent();
          });
        modal = modal || new Modal(modalContainer);
        modal.show();
      };
      modalToggle.addEventListener("click", onModalToggle);
    },
    dispose,
  };
})();
