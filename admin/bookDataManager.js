/**
 * bookDataManager.js
 * ---------------------------------------------------------------------------
 * DATA LAYER
 *
 * BookDataManager is the single source of truth for what a "book" and a
 * "page" look like, and the only place that is allowed to construct or
 * mutate them. The UI (BookEditorApp, PageSidebar, RichTextEditor) never
 * touches storage directly and never invents ids, timestamps, or default
 * fields itself — it always goes through a method here.
 *
 * BookDataManager itself does not know HOW data is persisted; it only knows
 * WHAT a book/page is and delegates all reads/writes to whatever storage
 * adapter it was constructed with (see storageAdapter.js). That's what makes
 * it safe to swap localStorage for GitHub/Firebase/Supabase/a REST API later
 * without touching this file's public API or any UI code.
 *
 * DATA SHAPE (Phase 1)
 *   Book {
 *     id: string
 *     title: string
 *     category: string
 *     coverImage: string|null   // data URL for now; will become a hosted URL later
 *     pages: Page[]
 *     createdAt: ISO string
 *     updatedAt: ISO string
 *   }
 *
 *   Page {
 *     id: string
 *     title: string
 *     content: string           // sanitized HTML from RichTextEditor
 *     createdAt: ISO string
 *     updatedAt: ISO string
 *   }
 *
 * FUTURE-PROOFING NOTES
 * Later block types (tables, images, charts, math, MCQs, note boxes) and
 * features (templates, drag & drop, autosave, version history, search,
 * AI-assist) are expected to layer on top of this shape rather than replace
 * it:
 *   - New block types just mean richer `page.content`, or eventually a
 *     `page.blocks` array alongside/instead of raw HTML — the CRUD methods
 *     below don't care what's inside `content`.
 *   - Version history can be added as a `book.history` log written to by
 *     saveBook()/updatePage() without changing their call signatures.
 *   - Autosave is just BookEditorApp calling saveBook()/updatePage() on a
 *     timer instead of on a button click; no change needed here.
 * ---------------------------------------------------------------------------
 */

export class BookDataManager {
  /**
   * @param {Object} storageAdapter  see storageAdapter.js for the required
   *                                 interface (listBooks/getBook/putBook/deleteBook).
   */
  constructor(storageAdapter) {
    this.storage = storageAdapter;
  }

  // ===========================================================================
  // Book lifecycle
  // ===========================================================================

  /** Lightweight summaries for the book picker. */
  async listBooks() {
    return this.storage.listBooks();
  }

  /** Full book document, including all pages. */
  async loadBook(bookId) {
    return this.storage.getBook(bookId);
  }

  /**
   * Creates a brand-new book with a single starter page, and persists it
   * immediately (so it shows up in the book picker right away).
   * @param {Object} fields
   * @param {string} fields.title
   * @param {string} fields.category
   * @param {string|null} [fields.coverImage]  data URL, stored as-is for Phase 1
   */
  async createBook({ title, category, coverImage = null }) {
    const now = this._now();
    const book = {
      id: this._makeId("book"),
      title: title.trim(),
      category,
      coverImage,
      pages: [this._makePage("Page 1")],
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.putBook(book);
    return book;
  }

  /** Persists whatever is currently on the in-memory book object, bumping updatedAt. */
  async saveBook(book) {
    const updated = { ...book, updatedAt: this._now() };
    await this.storage.putBook(updated);
    return updated;
  }

  /** Patches top-level book fields (title/category/coverImage/...) and persists. */
  async updateBook(book, patch) {
    const updated = { ...book, ...patch, updatedAt: this._now() };
    await this.storage.putBook(updated);
    return updated;
  }

  async deleteBook(bookId) {
    await this.storage.deleteBook(bookId);
  }

  // ===========================================================================
  // Page lifecycle
  // ===========================================================================
  //
  // All page methods take the in-memory `book` and return a NEW book object
  // with the updated `pages` array, already persisted via the storage
  // adapter. Callers should always reassign their local `currentBook`
  // reference to the returned value.

  async addPage(book, title = `Page ${book.pages.length + 1}`) {
    const updated = {
      ...book,
      pages: [...book.pages, this._makePage(title)],
      updatedAt: this._now(),
    };
    await this.storage.putBook(updated);
    return updated;
  }

  /** Patches fields (title/content/...) on a single page. */
  async updatePage(book, pageId, patch) {
    const now = this._now();
    const pages = book.pages.map((page) =>
      page.id === pageId ? { ...page, ...patch, updatedAt: now } : page
    );
    const updated = { ...book, pages, updatedAt: now };
    await this.storage.putBook(updated);
    return updated;
  }

  async deletePage(book, pageId) {
    const pages = book.pages.filter((page) => page.id !== pageId);
    const updated = { ...book, pages, updatedAt: this._now() };
    await this.storage.putBook(updated);
    return updated;
  }

  /** Inserts a copy of the given page directly after the original. */
  async duplicatePage(book, pageId) {
    const index = book.pages.findIndex((page) => page.id === pageId);
    if (index === -1) return book;

    const now = this._now();
    const original = book.pages[index];
    const copy = {
      ...original,
      id: this._makeId("page"),
      title: `${original.title} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };

    const pages = [...book.pages];
    pages.splice(index + 1, 0, copy);

    const updated = { ...book, pages, updatedAt: now };
    await this.storage.putBook(updated);
    return updated;
  }

  /**
   * Moves a page by one slot.
   * @param {number} direction  -1 to move up, +1 to move down
   */
  async movePage(book, pageId, direction) {
    const index = book.pages.findIndex((page) => page.id === pageId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= book.pages.length) {
      return book; // no-op: already at the top/bottom, or page not found
    }

    const pages = [...book.pages];
    [pages[index], pages[targetIndex]] = [pages[targetIndex], pages[index]];

    const updated = { ...book, pages, updatedAt: this._now() };
    await this.storage.putBook(updated);
    return updated;
  }

  /**
   * Moves a page to an arbitrary position in the pages array — used by
   * drag-and-drop reordering in the Pages panel (Phase 3).
   * @param {number} newIndex  target index, expressed in terms of the array
   *                           BEFORE the page is removed from its old slot
   */
  async reorderPage(book, pageId, newIndex) {
    const index = book.pages.findIndex((page) => page.id === pageId);
    if (index === -1) return book;

    const pages = [...book.pages];
    const [moved] = pages.splice(index, 1);

    let target = newIndex;
    if (index < newIndex) target -= 1; // account for the slot we just removed
    target = Math.max(0, Math.min(target, pages.length));
    pages.splice(target, 0, moved);

    const updated = { ...book, pages, updatedAt: this._now() };
    await this.storage.putBook(updated);
    return updated;
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  _makePage(title) {
    const now = this._now();
    return {
      id: this._makeId("page"),
      title,
      content: "",
      createdAt: now,
      updatedAt: now,
    };
  }

  _makeId(prefix) {
    const random =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${random}`;
  }

  _now() {
    return new Date().toISOString();
  }
}
