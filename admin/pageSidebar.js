/**
 * pageSidebar.js
 * ---------------------------------------------------------------------------
 * Pure UI component for the left "pages" panel. It knows how to render a
 * list of page cards and how to raise events (via the callbacks passed in);
 * it never talks to BookDataManager or localStorage directly. That keeps
 * data logic and UI logic separated, per the project's architecture rules.
 *
 * Phase 3 additions (page management):
 *   - Drag-and-drop reordering (drag by the left-hand handle)
 *   - A three-dot / right-click menu with Move Up, Move Down, Rename,
 *     Duplicate, Delete
 *   - A live text thumbnail preview, updatable in place via updateThumbnail()
 *   - scrollToPage() so the app can bring a newly created page into view
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
   * @param {Function} [callbacks.onReorder]  (pageId, newIndex) => void
   */
  constructor(listEl, callbacks) {
    this.listEl = listEl;
    this.callbacks = callbacks;
    this._dragId = null;
    this._openMenuId = null;

    // Close any open three-dot menu when the user clicks anywhere else.
    document.addEventListener("click", () => this._closeMenus());
  }

  /**
   * @param {Array} pages           book.pages, already in display order
   * @param {string|null} activeId  currently selected page id
   */
  render(pages, activeId) {
    this.listEl.innerHTML = "";
    this._openMenuId = null;

    pages.forEach((page, index) => {
      const card = document.createElement("div");
      card.className = "page-card" + (page.id === activeId ? " is-active" : "");
      card.dataset.pageId = page.id;
      card.draggable = true;

      card.innerHTML = `
        <span class="page-card__handle" title="Drag to reorder" aria-hidden="true">&#8942;&#8942;</span>
        <div class="page-card__thumb">${this._thumbHtml(page)}</div>
        <div class="page-card__row">
          <span class="page-card__title">${this._escape(page.title)}</span>
          <span class="page-card__index">${index + 1}</span>
          <div class="page-card__menu">
            <button type="button" class="page-card__menu-btn" data-action="menu"
                    title="More options" aria-haspopup="true" aria-expanded="false">&#8942;</button>
            <div class="page-card__menu-dropdown" hidden>
              <button type="button" data-action="moveUp">Move Up</button>
              <button type="button" data-action="moveDown">Move Down</button>
              <button type="button" data-action="rename">Rename</button>
              <button type="button" data-action="duplicate">Duplicate</button>
              <button type="button" class="danger" data-action="delete">Delete</button>
            </div>
          </div>
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

        if (action === "menu") {
          this._toggleMenu(card, page.id);
          return;
        }

        this._closeMenus();
        const map = {
          moveUp: this.callbacks.onMoveUp,
          moveDown: this.callbacks.onMoveDown,
          rename: this.callbacks.onRename,
          duplicate: this.callbacks.onDuplicate,
          delete: this.callbacks.onDelete,
        };
        if (map[action]) map[action](page.id);
      });

      // Right-click also opens the same options menu.
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._toggleMenu(card, page.id, true);
      });

      // -- Drag-and-drop reordering (initiated only from the handle) --------
      card.addEventListener("dragstart", (e) => {
        if (!e.target.closest(".page-card__handle")) {
          e.preventDefault();
          return;
        }
        this._dragId = page.id;
        card.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", page.id);
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        this._clearDragIndicators();
        this._dragId = null;
      });

      card.addEventListener("dragover", (e) => {
        if (!this._dragId || this._dragId === page.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = card.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        this._clearDragIndicators();
        card.classList.add(before ? "drag-over-top" : "drag-over-bottom");
      });

      card.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!this._dragId || this._dragId === page.id) return;
        const rect = card.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        const targetIndex = index + (before ? 0 : 1);
        this._clearDragIndicators();
        if (this.callbacks.onReorder) this.callbacks.onReorder(this._dragId, targetIndex);
        this._dragId = null;
      });

      this.listEl.appendChild(card);
    });
  }

  /**
   * Refreshes just one page's thumbnail preview in place, without
   * re-rendering the whole list — keeps drag state and open menus intact
   * while the user is actively typing.
   */
  updateThumbnail(pageId, contentHtml) {
    const card = this.listEl.querySelector(`[data-page-id="${pageId}"]`);
    if (!card) return;
    const thumb = card.querySelector(".page-card__thumb");
    if (thumb) thumb.innerHTML = this._thumbHtml({ content: contentHtml });
  }

  /** Scrolls a page card into view (used right after a new page is created). */
  scrollToPage(pageId) {
    const card = this.listEl.querySelector(`[data-page-id="${pageId}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  _toggleMenu(card, pageId, forceOpen = false) {
    const dropdown = card.querySelector(".page-card__menu-dropdown");
    const btn = card.querySelector(".page-card__menu-btn");
    const isOpen = this._openMenuId === pageId && !dropdown.hidden;
    this._closeMenus();
    if (forceOpen || !isOpen) {
      dropdown.hidden = false;
      if (btn) btn.setAttribute("aria-expanded", "true");
      this._openMenuId = pageId;
    }
  }

  _closeMenus() {
    this.listEl.querySelectorAll(".page-card__menu-dropdown").forEach((el) => { el.hidden = true; });
    this.listEl.querySelectorAll(".page-card__menu-btn").forEach((el) => el.setAttribute("aria-expanded", "false"));
    this._openMenuId = null;
  }

  _clearDragIndicators() {
    this.listEl.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
  }

  _thumbHtml(page) {
    const text = this._stripHtml(page.content).trim();
    if (!text) {
      return `
        <div class="page-card__thumb-line w-60"></div>
        <div class="page-card__thumb-line w-90"></div>
        <div class="page-card__thumb-line w-90"></div>
        <div class="page-card__thumb-line w-40"></div>
      `;
    }
    return `<div class="page-card__thumb-text">${this._escape(text.slice(0, 240))}</div>`;
  }

  _stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return div.textContent || "";
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }
}
