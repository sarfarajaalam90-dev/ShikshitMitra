/**
 * bookEditorApp.js
 * ---------------------------------------------------------------------------
 * Application entry point. Wires the data layer (BookDataManager) to the UI
 * components (PageSidebar, RichTextEditor) and owns the small amount of
 * "app state" that doesn't belong to either: which book/page is currently
 * open, and whether there are unsaved changes.
 *
 * This file intentionally stays thin — it delegates rendering to the UI
 * components and all persistence to BookDataManager, per the project's
 * "separate UI logic from data logic" requirement.
 * ---------------------------------------------------------------------------
 */

import { LocalStorageAdapter } from "./storageAdapter.js";
import { BookDataManager } from "./bookDataManager.js";
import { RichTextEditor } from "./richTextEditor.js";
import { PageSidebar } from "./pageSidebar.js";

const CATEGORIES = ["Loksewa", "Nepali", "English", "General Knowledge", "Science", "Mathematics", "Other"];

class BookEditorApp {
  constructor() {
    // -- Data layer -------------------------------------------------------
    this.dataManager = new BookDataManager(new LocalStorageAdapter());

    // -- App state ----------------------------------------------------------
    this.currentBook = null;
    this.currentPageId = null;
    this.isDirty = false;

    // -- DOM references ------------------------------------------------------
    this.el = {
      bookPicker: document.getElementById("bookPicker"),
      newBookBtn: document.getElementById("newBookBtn"),
      addPageBtn: document.getElementById("addPageBtn"),
      addPageBtnBottom: document.getElementById("addPageBtnBottom"),
      pageList: document.getElementById("pageList"),
      canvasScroll: document.getElementById("canvasScroll"),
      pageSheet: document.getElementById("pageSheet"),
      pageTitleInput: document.getElementById("pageTitleInput"),
      richTextSurface: document.getElementById("richTextSurface"),
      toolbar: document.getElementById("toolbar"),
      emptyState: document.getElementById("emptyState"),
      saveBtn: document.getElementById("saveBookBtn"),
      previewBtn: document.getElementById("previewBookBtn"),
      footerStatus: document.getElementById("footerStatus"),
      toast: document.getElementById("toast"),
      // Properties panel
      propBookTitle: document.getElementById("propBookTitle"),
      propBookCategory: document.getElementById("propBookCategory"),
      propCoverPreview: document.getElementById("propCoverPreview"),
      propPageCount: document.getElementById("propPageCount"),
      propUpdatedAt: document.getElementById("propUpdatedAt"),
      // New book modal
      newBookModal: document.getElementById("newBookModal"),
      newBookForm: document.getElementById("newBookForm"),
      newBookTitle: document.getElementById("newBookTitle"),
      newBookCategory: document.getElementById("newBookCategory"),
      newBookCover: document.getElementById("newBookCover"),
      newBookCoverPreview: document.getElementById("newBookCoverPreview"),
      closeNewBookModal: document.getElementById("closeNewBookModal"),
      cancelNewBookModal: document.getElementById("cancelNewBookModal"),
    };

    this._pendingCoverDataUrl = null;

    this._populateCategorySelect(this.el.newBookCategory);

    this.pageSidebar = new PageSidebar(this.el.pageList, {
      onSelect: (pageId) => this.selectPage(pageId),
      onRename: (pageId) => this.renamePage(pageId),
      onDelete: (pageId) => this.deletePage(pageId),
      onDuplicate: (pageId) => this.duplicatePage(pageId),
      onMoveUp: (pageId) => this.movePage(pageId, -1),
      onMoveDown: (pageId) => this.movePage(pageId, 1),
      onReorder: (pageId, newIndex) => this.reorderPages(pageId, newIndex),
    });

    this.richTextEditor = new RichTextEditor(this.el.richTextSurface, this.el.toolbar, {
      onChange: () => {
        this._markDirty();
        if (this.currentPageId) {
          this.pageSidebar.updateThumbnail(this.currentPageId, this.richTextEditor.getHTML());
        }
      },
    });

    this._bindGlobalEvents();
    this._setFooterStatus("saved");
    this._refreshPageActionAvailability();

    this.init();
  }

  // ===========================================================================
  // Bootstrapping
  // ===========================================================================

  async init() {
    const books = await this.dataManager.listBooks();
    this._renderBookPicker(books);

    if (books.length > 0) {
      await this.openBook(books[0].id);
    } else {
      this._renderEmptyBookState();
    }
  }

  _bindGlobalEvents() {
    this.el.bookPicker.addEventListener("change", (e) => {
      if (e.target.value) this.openBook(e.target.value);
    });

    this.el.newBookBtn.addEventListener("click", () => this._openNewBookModal());
    this.el.closeNewBookModal.addEventListener("click", () => this._closeNewBookModal());
    this.el.cancelNewBookModal.addEventListener("click", () => this._closeNewBookModal());
    this.el.newBookForm.addEventListener("submit", (e) => this._handleCreateBook(e));

    this.el.newBookCover.addEventListener("change", (e) => this._handleCoverFileChange(e));

    this.el.addPageBtn.addEventListener("click", () => this.addPage());
    this.el.addPageBtnBottom.addEventListener("click", () => this.addPage());

    this.el.pageTitleInput.addEventListener("input", () => {
      this._markDirty();
      const card = this.el.pageList.querySelector(`[data-page-id="${this.currentPageId}"] .page-card__title`);
      if (card) card.textContent = this.el.pageTitleInput.value;
    });
    this.el.pageTitleInput.addEventListener("blur", () => this._persistCurrentPageFields());

    this.el.saveBtn.addEventListener("click", () => this.saveBook());
    this.el.previewBtn.addEventListener("click", () => this.previewBook());

    // Warn before leaving with unsaved changes.
    window.addEventListener("beforeunload", (e) => {
      if (this.isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Ctrl/Cmd+S saves the book. Bound at the document level (rather than
    // inside RichTextEditor) so it works whether focus is in the editor
    // surface, the page title field, or anywhere else on the page.
    document.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.saveBook();
      }
    });
  }

  _populateCategorySelect(selectEl) {
    selectEl.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  }

  // ===========================================================================
  // Book picker / book lifecycle
  // ===========================================================================

  _renderBookPicker(books) {
    const current = this.currentBook?.id;
    this.el.bookPicker.innerHTML =
      `<option value="" disabled ${!current ? "selected" : ""}>Select a book&hellip;</option>` +
      books.map((b) => `<option value="${b.id}" ${b.id === current ? "selected" : ""}>${this._escape(b.title)}</option>`).join("");
  }

  async openBook(bookId) {
    if (this.isDirty && !confirm("You have unsaved changes. Switch books anyway?")) {
      this.el.bookPicker.value = this.currentBook?.id || "";
      return;
    }
    const book = await this.dataManager.loadBook(bookId);
    if (!book) return;

    this.currentBook = book;
    this.currentPageId = book.pages[0]?.id || null;

    this.el.bookPicker.value = book.id;
    this._renderProperties();
    this.pageSidebar.render(book.pages, this.currentPageId);

    if (this.currentPageId) {
      this._loadPageIntoEditor(this.currentPageId);
    } else {
      this._renderEmptyPageState();
    }

    this._refreshPageActionAvailability();
    this._setFooterStatus("saved");
  }

  _renderEmptyBookState() {
    this.currentBook = null;
    this.currentPageId = null;
    this.pageSidebar.render([], null);
    this._renderProperties();
    this._renderEmptyPageState("Create a book to get started, or select one above.");
    this._refreshPageActionAvailability();
  }

  _renderEmptyPageState(message = "This book has no pages yet. Click \u201cAdd Page\u201d to start writing.") {
    this.el.pageSheet.hidden = true;
    this.el.emptyState.hidden = false;
    this.el.emptyState.querySelector("p").textContent = message;
    this.richTextEditor.setEnabled(false);
  }

  // ===========================================================================
  // New Book modal
  // ===========================================================================

  _openNewBookModal() {
    this.el.newBookForm.reset();
    this._pendingCoverDataUrl = null;
    this.el.newBookCoverPreview.innerHTML = "Cover preview";
    this.el.newBookModal.hidden = false;
    this.el.newBookTitle.focus();
  }

  _closeNewBookModal() {
    this.el.newBookModal.hidden = true;
  }

  _handleCoverFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this._pendingCoverDataUrl = reader.result;
      this.el.newBookCoverPreview.innerHTML = `<img src="${reader.result}" alt="Cover preview" />`;
    };
    reader.readAsDataURL(file);
  }

  async _handleCreateBook(e) {
    e.preventDefault();
    const title = this.el.newBookTitle.value.trim();
    if (!title) return;

    const book = await this.dataManager.createBook({
      title,
      category: this.el.newBookCategory.value,
      coverImage: this._pendingCoverDataUrl,
    });

    this._closeNewBookModal();
    const books = await this.dataManager.listBooks();
    this._renderBookPicker(books);
    await this.openBook(book.id);
    this._showToast(`"${book.title}" created`);
  }

  // ===========================================================================
  // Page selection / editing
  // ===========================================================================

  _loadPageIntoEditor(pageId) {
    const page = this.currentBook.pages.find((p) => p.id === pageId);
    if (!page) return;

    this.el.emptyState.hidden = true;
    this.el.pageSheet.hidden = false;
    this.richTextEditor.setEnabled(true);

    this.el.pageTitleInput.value = page.title;
    this.richTextEditor.setHTML(page.content);
  }

  async selectPage(pageId) {
    if (pageId === this.currentPageId) return;
    await this._persistCurrentPageFields(); // save the page we're leaving
    this.currentPageId = pageId;
    this._loadPageIntoEditor(pageId);
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
  }

  /** Writes the on-screen title/content back into the in-memory book object (not yet persisted to storage). */
  _syncCurrentPageFromEditor() {
    if (!this.currentBook || !this.currentPageId) return;
    const page = this.currentBook.pages.find((p) => p.id === this.currentPageId);
    if (!page) return;
    page.title = this.el.pageTitleInput.value.trim() || page.title;
    page.content = this.richTextEditor.getHTML();
  }

  async _persistCurrentPageFields() {
    if (!this.currentBook || !this.currentPageId) return;
    this._syncCurrentPageFromEditor();
  }

  // ===========================================================================
  // Page management actions
  // ===========================================================================

  async addPage() {
    if (!this.currentBook) {
      alert("Create or select a book first.");
      return;
    }
    await this._persistCurrentPageFields();
    this.currentBook = await this.dataManager.addPage(this.currentBook);
    const newPage = this.currentBook.pages[this.currentBook.pages.length - 1];
    this.currentPageId = newPage.id;
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    this.pageSidebar.scrollToPage(newPage.id);
    this._loadPageIntoEditor(this.currentPageId);
    this._renderProperties();
    this._refreshPageActionAvailability();
    this._setFooterStatus("saved");
    this.richTextEditor.focus();
  }

  async reorderPages(pageId, newIndex) {
    await this._persistCurrentPageFields();
    this.currentBook = await this.dataManager.reorderPage(this.currentBook, pageId, newIndex);
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    this._setFooterStatus("saved");
  }

  async renamePage(pageId) {
    const page = this.currentBook.pages.find((p) => p.id === pageId);
    if (!page) return;
    const newTitle = prompt("Rename page", page.title);
    if (!newTitle || !newTitle.trim()) return;
    this.currentBook = await this.dataManager.updatePage(this.currentBook, pageId, { title: newTitle.trim() });
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    if (pageId === this.currentPageId) this.el.pageTitleInput.value = newTitle.trim();
    this._setFooterStatus("saved");
  }

  async deletePage(pageId) {
    const page = this.currentBook.pages.find((p) => p.id === pageId);
    if (!page) return;
    if (!confirm(`Delete "${page.title}"? This can't be undone.`)) return;

    this.currentBook = await this.dataManager.deletePage(this.currentBook, pageId);

    if (this.currentPageId === pageId) {
      this.currentPageId = this.currentBook.pages[0]?.id || null;
    }
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    if (this.currentPageId) {
      this._loadPageIntoEditor(this.currentPageId);
    } else {
      this._renderEmptyPageState();
    }
    this._renderProperties();
    this._refreshPageActionAvailability();
    this._setFooterStatus("saved");
  }

  async duplicatePage(pageId) {
    await this._persistCurrentPageFields();
    this.currentBook = await this.dataManager.duplicatePage(this.currentBook, pageId);
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    this._renderProperties();
    this._refreshPageActionAvailability();
    this._setFooterStatus("saved");
  }

  async movePage(pageId, direction) {
    await this._persistCurrentPageFields();
    this.currentBook = await this.dataManager.movePage(this.currentBook, pageId, direction);
    this.pageSidebar.render(this.currentBook.pages, this.currentPageId);
    this._setFooterStatus("saved");
  }

  _refreshPageActionAvailability() {
    this.el.addPageBtn.disabled = !this.currentBook;
    this.el.addPageBtnBottom.disabled = !this.currentBook;
  }

  // ===========================================================================
  // Properties panel
  // ===========================================================================

  _renderProperties() {
    const book = this.currentBook;
    this.el.propBookTitle.textContent = book ? book.title : "\u2014";
    this.el.propBookCategory.textContent = book ? book.category : "\u2014";
    this.el.propPageCount.textContent = book ? String(book.pages.length) : "0";
    this.el.propUpdatedAt.textContent = book ? new Date(book.updatedAt).toLocaleString() : "\u2014";
    this.el.propCoverPreview.innerHTML = book?.coverImage
      ? `<img src="${book.coverImage}" alt="${this._escape(book.title)} cover" />`
      : "No cover uploaded";
  }

  // ===========================================================================
  // Save / Preview
  // ===========================================================================

  async saveBook() {
    if (!this.currentBook) return;
    this._syncCurrentPageFromEditor();
    this.currentBook = await this.dataManager.saveBook(this.currentBook);
    this._renderProperties();
    const books = await this.dataManager.listBooks();
    this._renderBookPicker(books);
    this._setFooterStatus("saved");
    this._showToast("Book saved");
  }

  previewBook() {
    if (!this.currentBook) return;
    this._syncCurrentPageFromEditor();

    const pagesHtml = this.currentBook.pages
      .map((page) => `
        <section class="preview-page">
          <h1 class="preview-page__title">${this._escape(page.title)}</h1>
          <div class="preview-page__content">${page.content || "<p><em>(Empty page)</em></p>"}</div>
        </section>
      `)
      .join("\n");

    const doc = `<!DOCTYPE html>
<html lang="ne">
<head>
<meta charset="UTF-8" />
<title>${this._escape(this.currentBook.title)} \u2014 Preview</title>
<style>
  body { font-family: Georgia, "Noto Serif Devanagari", serif; background: #eef1ee; margin: 0; padding: 40px 16px; }
  .preview-header { max-width: 760px; margin: 0 auto 24px; text-align: center; }
  .preview-header h1 { color: #0f3d24; margin-bottom: 4px; }
  .preview-header p { color: #6b7670; font-family: Segoe UI, sans-serif; font-size: 13px; }
  .preview-page { max-width: 760px; margin: 0 auto 32px; background: #fff; padding: 60px; border-radius: 4px;
                  box-shadow: 0 1px 3px rgba(26,31,28,.12), 0 8px 24px rgba(26,31,28,.08); }
  .preview-page__title { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #6b7670;
                          font-family: Segoe UI, sans-serif; margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid #dde3df; }
  .preview-page__content h2 { color: #0f3d24; }
  .preview-page__content { line-height: 1.75; color: #1a1f1c; }
</style>
</head>
<body>
  <div class="preview-header">
    <h1>${this._escape(this.currentBook.title)}</h1>
    <p>${this._escape(this.currentBook.category)} &middot; ${this.currentBook.pages.length} page(s) &middot; Preview only, not the reader view</p>
  </div>
  ${pagesHtml}
</body>
</html>`;

    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }

  // ===========================================================================
  // Small UI helpers
  // ===========================================================================

  _markDirty() {
    this.isDirty = true;
    this._setFooterStatus("dirty");
  }

  _setFooterStatus(state) {
    const el = this.el.footerStatus;
    el.classList.remove("is-saved", "is-dirty");
    if (state === "saved") {
      this.isDirty = false;
      el.classList.add("is-saved");
      el.querySelector("span:last-child").textContent = "All changes saved";
    } else {
      el.classList.add("is-dirty");
      el.querySelector("span:last-child").textContent = "Unsaved changes";
    }
  }

  _showToast(message) {
    const toast = this.el.toast;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.bookEditorApp = new BookEditorApp();
});
