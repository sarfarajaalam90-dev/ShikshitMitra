/**
 * pageSidebar.js
 * ---------------------------------------------------------------------------
 * Pure UI component for the left "pages" panel. It knows how to render a
 * list of page cards and how to raise events (via the callbacks passed in);
 * it never talks to BookDataManager or localStorage directly. That keeps
 * data logic and UI logic separated, per the project's architecture rules.
 * ---------------------------------------------------------------------------
 */

export class PageSidebar {
  /**
   * @param {HTMLElement} listEl  container that page cards are rendered into
   * @param {Object} callbacks
   * @param {Function} callbacks.onSelect     (pageId) => void
   * @param {Function} callbacks.onRename     (pageId) => void
   * @param {Function} callbacks.onDelete     (pageId) => void
   * @param {Function} callbacks.onDuplicate  (pageId) => void
   * @param {Function} callbacks.onMoveUp     (pageId) => void
   * @param {Function} callbacks.onMoveDown   (pageId) => void
   */
  constructor(listEl, callbacks) {
    this.listEl = listEl;
    this.callbacks = callbacks;
  }

  /**
   * @param {Array} pages           book.pages, already in display order
   * @param {string|null} activeId  currently selected page id
   */
  render(pages, activeId) {
    this.listEl.innerHTML = "";

    pages.forEach((page, index) => {
      const card = document.createElement("div");
      card.className = "page-card" + (page.id === activeId ? " is-active" : "");
      card.dataset.pageId = page.id;

      card.innerHTML = `
        <div class="page-card__thumb">
          <div class="page-card__thumb-line w-60"></div>
          <div class="page-card__thumb-line w-90"></div>
          <div class="page-card__thumb-line w-90"></div>
          <div class="page-card__thumb-line w-40"></div>
        </div>
        <div class="page-card__row">
          <span class="page-card__title">${this._escape(page.title)}</span>
          <span class="page-card__index">${index + 1}</span>
        </div>
        <div class="page-card__actions">
          <button type="button" data-action="moveUp" title="Move up">&#8593;</button>
          <button type="button" data-action="moveDown" title="Move down">&#8595;</button>
          <button type="button" data-action="rename" title="Rename">&#9998;</button>
          <button type="button" data-action="duplicate" title="Duplicate">&#10063;</button>
          <button type="button" class="danger" data-action="delete" title="Delete">&#128465;</button>
        </div>
      `;

      card.addEventListener("click", (e) => {
        const actionBtn = e.target.closest("[data-action]");
        if (!actionBtn) {
          this.callbacks.onSelect(page.id);
          return;
        }
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const map = {
          moveUp: this.callbacks.onMoveUp,
          moveDown: this.callbacks.onMoveDown,
          rename: this.callbacks.onRename,
          duplicate: this.callbacks.onDuplicate,
          delete: this.callbacks.onDelete,
        };
        if (map[action]) map[action](page.id);
      });

      this.listEl.appendChild(card);
    });
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }
}
