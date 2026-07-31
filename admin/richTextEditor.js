/**
 * richTextEditor.js
 * ---------------------------------------------------------------------------
 * A small, self-contained rich text editing component built on
 * contenteditable + document.execCommand. It exposes a plain get/set HTML
 * API so the rest of the app never has to think about DOM internals or
 * execCommand quirks.
 *
 * Phase 1 supports: Heading / Paragraph blocks, Bold, Italic, Underline,
 * Font size, and text alignment (left/center/right).
 *
 * EXTENSION POINT
 * Future block types (tables, images, charts, math, MCQs, note boxes) can
 * be added as new toolbar buttons that insert their own markup/components
 * into the same contenteditable surface, or — if they need real
 * interactivity — as separate custom elements swapped in per block. Nothing
 * about this class's public API (getHTML/setHTML/on) needs to change for
 * that; only the toolbar wiring grows.
 * ---------------------------------------------------------------------------
 */

export class RichTextEditor {
  /**
   * @param {HTMLElement} surfaceEl   the contenteditable element
   * @param {HTMLElement} toolbarEl   the toolbar container to wire buttons in
   * @param {Object} options
   * @param {Function} options.onChange  called (debounced) whenever content changes
   */
  constructor(surfaceEl, toolbarEl, { onChange } = {}) {
    this.surface = surfaceEl;
    this.toolbar = toolbarEl;
    this.onChange = onChange || (() => {});
    this._changeTimer = null;

    this._buildToolbar();
    this._bindSurfaceEvents();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  getHTML() {
    return this.surface.innerHTML.trim();
  }

  setHTML(html) {
    this.surface.innerHTML = html || "";
  }

  focus() {
    this.surface.focus();
  }

  setEnabled(enabled) {
    this.surface.contentEditable = enabled ? "true" : "false";
    this.toolbar.querySelectorAll("button, select").forEach((el) => { el.disabled = !enabled; });
  }

  // ---------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------

  _buildToolbar() {
    this.toolbar.innerHTML = `
      <div class="toolbar__group">
        <select class="toolbar__select" data-cmd="formatBlock" title="Block style">
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
        </select>
      </div>
      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="toolbar__btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="toolbar__btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
      </div>
      <div class="toolbar__group">
        <select class="toolbar__select" data-cmd="fontSize" title="Font size">
          <option value="2">Small</option>
          <option value="3" selected>Normal</option>
          <option value="4">Medium</option>
          <option value="5">Large</option>
          <option value="6">X-Large</option>
        </select>
      </div>
      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-cmd="justifyLeft" title="Align left">&#8676;</button>
        <button type="button" class="toolbar__btn" data-cmd="justifyCenter" title="Align center">&#8596;</button>
        <button type="button" class="toolbar__btn" data-cmd="justifyRight" title="Align right">&#8677;</button>
      </div>
    `;

    // Buttons: simple execCommand toggles.
    this.toolbar.querySelectorAll("button[data-cmd]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection
      btn.addEventListener("click", () => {
        this.surface.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        this._updateToolbarState();
        this._emitChange();
      });
    });

    // Selects: formatBlock / fontSize take a value argument.
    this.toolbar.querySelectorAll("select[data-cmd]").forEach((select) => {
      select.addEventListener("change", () => {
        this.surface.focus();
        document.execCommand(select.dataset.cmd, false, select.value);
        this._emitChange();
      });
    });
  }

  /** Reflects current selection state (bold/italic/... pressed) on the toolbar. */
  _updateToolbarState() {
    const stateCmds = ["bold", "italic", "underline", "justifyLeft", "justifyCenter", "justifyRight"];
    stateCmds.forEach((cmd) => {
      const btn = this.toolbar.querySelector(`button[data-cmd="${cmd}"]`);
      if (!btn) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (_) { active = false; }
      btn.classList.toggle("is-active", active);
    });
  }

  // ---------------------------------------------------------------------
  // Surface events
  // ---------------------------------------------------------------------

  _bindSurfaceEvents() {
    this.surface.addEventListener("input", () => this._emitChange());
    this.surface.addEventListener("keyup", () => this._updateToolbarState());
    this.surface.addEventListener("mouseup", () => this._updateToolbarState());
    this.surface.addEventListener("focus", () => this._updateToolbarState());

    // Keep pasted content reasonably clean (strip inline styles/classes from
    // other websites/Word so pages don't inherit foreign fonts/colors).
    this.surface.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
  }

  _emitChange() {
    clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => this.onChange(this.getHTML()), 250);
  }
}
