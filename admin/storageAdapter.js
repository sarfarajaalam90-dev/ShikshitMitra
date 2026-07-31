/**
 * storageAdapter.js
 * ---------------------------------------------------------------------------
 * STORAGE ADAPTER LAYER
 *
 * This is the ONLY file that is allowed to know how/where book data is
 * physically persisted. Everything above it (BookDataManager, and the UI on
 * top of that) talks to a generic, backend-agnostic interface:
 *
 *   async listBooks()          -> [{ id, title, category, updatedAt }, ...]
 *   async getBook(id)          -> full book object | null
 *   async putBook(book)        -> writes/overwrites a full book object
 *   async deleteBook(id)       -> removes a book
 *
 * Why this shape:
 * - "list" returns lightweight summaries so a future backend (Firebase,
 *   Supabase, a GitHub-backed JSON store, a REST API...) doesn't have to
 *   download every full book just to populate the book picker.
 * - "getBook" / "putBook" deal in whole book documents, which keeps the
 *   adapter dead simple: no partial-update semantics to reimplement per
 *   backend. BookDataManager is responsible for merging changes into a full
 *   book object before calling putBook().
 * - Every method is async, even LocalStorageAdapter's, so that swapping in a
 *   network-backed adapter later (Firebase/Supabase/GitHub API/a REST
 *   service) is a drop-in replacement with no call-site changes anywhere in
 *   the app.
 *
 * TO ADD A NEW BACKEND LATER:
 *   Create e.g. FirebaseAdapter / SupabaseAdapter / GitHubAdapter implementing
 *   the same four methods, then swap the one line in bookEditorApp.js:
 *     new BookDataManager(new LocalStorageAdapter())
 *   becomes
 *     new BookDataManager(new FirebaseAdapter(config))
 *   Nothing in BookDataManager or the UI layer needs to change.
 * ---------------------------------------------------------------------------
 */

const STORAGE_KEY = "shikshitMitra.bookEditor.books.v1";

export class LocalStorageAdapter {
  /**
   * @param {Storage} storage  defaults to window.localStorage; injectable for testing.
   */
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Reads the full { [bookId]: book } map from storage. Never throws. */
  _readAll() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error("[LocalStorageAdapter] Failed to read book data, starting fresh.", err);
      return {};
    }
  }

  /** Writes the full { [bookId]: book } map back to storage. */
  _writeAll(booksById) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(booksById));
  }

  // -------------------------------------------------------------------------
  // Public adapter interface
  // -------------------------------------------------------------------------

  async listBooks() {
    const booksById = this._readAll();
    return Object.values(booksById)
      .map((book) => ({
        id: book.id,
        title: book.title,
        category: book.category,
        coverImage: book.coverImage || null,
        pageCount: book.pages?.length || 0,
        updatedAt: book.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  async getBook(id) {
    const booksById = this._readAll();
    return booksById[id] || null;
  }

  async putBook(book) {
    const booksById = this._readAll();
    booksById[book.id] = book;
    this._writeAll(booksById);
    return book;
  }

  async deleteBook(id) {
    const booksById = this._readAll();
    delete booksById[id];
    this._writeAll(booksById);
  }
}
