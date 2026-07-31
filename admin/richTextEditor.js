/**
 * richTextEditor.js
 * ---------------------------------------------------------------------------
 * A self-contained rich text editing component built on contenteditable +
 * document.execCommand. It exposes a plain get/set HTML API so the rest of
 * the app never has to think about DOM internals or execCommand quirks.
 *
 * PHASE 1 supported: Heading / Paragraph blocks, Bold, Italic, Underline,
 * Font size, and text alignment.
 *
 * PHASE 2 adds real authoring tools on top of that same surface:
 *   - Headings H1–H3, Quote box, Code block (via formatBlock)
 *   - Text color, Highlight
 *   - Bullet & numbered lists
 *   - Tables (grid-size picker, Tab/Shift+Tab cell navigation)
 *   - Image upload with drag (native contenteditable dragging of an atomic
 *     element) and a corner handle for resizing
 *   - Horizontal rule
 *   - A custom Undo/Redo history stack (snapshot-based, so it stays correct
 *     across DOM-level edits like image resize/table insert, not just typed
 *     text — the browser's native execCommand('undo') can't be trusted once
 *     other custom DOM changes are involved)
 *   - Keyboard shortcuts: Ctrl/Cmd+B/I/U, Ctrl/Cmd+Z (undo),
 *     Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y (redo). Ctrl/Cmd+S is handled one level
 *     up, in bookEditorApp.js, since it needs to work even when focus isn't
 *     inside the editor surface.
 *
 * EXTENSION POINT
 * Further block types (charts, math, MCQs, note boxes) and behaviors
 * (drag-and-drop block reordering, autosave, version history, search,
 * AI-assist) can still be added as new toolbar entries or surface behaviors
 * without changing this class's public API (getHTML/setHTML/on...).
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
    this._historyTimer = null;

    // -- Undo/Redo history ---------------------------------------------------
    this._history = [];
    this._historyIndex = -1;
    this._historyLimit = 100;
    this._suppressHistory = false;

    this._buildToolbar();
    this._bindSurfaceEvents();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  getHTML() {
    return this.surface.innerHTML.trim();
  }

  setHTML(html) {
    this.surface.innerHTML = html || "";
    this._bindImageHandles();
    // A freshly loaded page starts its own history — undoing shouldn't reach
    // back into whatever page was open before it.
    this._history = [this.getHTML()];
    this._historyIndex = 0;
    this._updateHistoryButtons();
  }

  focus() {
    this.surface.focus();
  }

  setEnabled(enabled) {
    this.surface.contentEditable = enabled ? "true" : "false";
    this.toolbar.querySelectorAll("button, select, input").forEach((el) => { el.disabled = !enabled; });
  }

  undo() {
    if (this._historyIndex <= 0) return;
    this._historyIndex--;
    this._restoreHistory();
  }

  redo() {
    if (this._historyIndex >= this._history.length - 1) return;
    this._historyIndex++;
    this._restoreHistory();
  }

  // ===========================================================================
  // Toolbar construction
  // ===========================================================================

  _buildToolbar() {
    this.toolbar.innerHTML = `
      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-action="undo" title="Undo (Ctrl+Z)">&#8630;</button>
        <button type="button" class="toolbar__btn" data-action="redo" title="Redo (Ctrl+Shift+Z)">&#8631;</button>
      </div>

      <div class="toolbar__group">
        <select class="toolbar__select" data-cmd="formatBlock" title="Block style">
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote box</option>
          <option value="pre">Code block</option>
        </select>
      </div>

      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="toolbar__btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="toolbar__btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
      </div>

      <div class="toolbar__group">
        <label class="toolbar__color" title="Text color">
          <span class="toolbar__color-icon">A</span>
          <input type="color" data-cmd="foreColor" value="#1a1f1c" />
        </label>
        <label class="toolbar__color" title="Highlight">
          <span class="toolbar__color-icon">&#9998;</span>
          <input type="color" data-cmd="hiliteColor" value="#fdf1c8" />
        </label>
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

      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-cmd="insertUnorderedList" title="Bullet list">&#8226;&#8226;&#8226;</button>
        <button type="button" class="toolbar__btn" data-cmd="insertOrderedList" title="Numbered list">1.2.3.</button>
      </div>

      <div class="toolbar__group toolbar__group--relative">
        <button type="button" class="toolbar__btn" data-action="openTablePicker" title="Insert table">&#9638;</button>
        <div class="toolbar__popover" data-popover="table">
          <div class="table-grid" data-table-grid></div>
          <div class="table-grid__label" data-table-label>Insert table</div>
        </div>
      </div>

      <div class="toolbar__group">
        <button type="button" class="toolbar__btn" data-action="insertImage" title="Insert image">&#128247;</button>
        <input type="file" accept="image/*" class="toolbar__file-input" data-image-input hidden />
        <button type="button" class="toolbar__btn" data-cmd="insertHorizontalRule" title="Horizontal line">&#8213;</button>
      </div>
    `;

    this._wireSimpleCommandControls();
    this._wireColorControls();
    this._wireActionButtons();
    this._wireTablePicker();
    this._wireImageInput();
  }

  /** Buttons/selects that map directly onto a single document.execCommand call. */
  _wireSimpleCommandControls() {
    this.toolbar.querySelectorAll("button[data-cmd]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection
      btn.addEventListener("click", () => {
        this.surface.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        this._updateToolbarState();
        this._pushHistory();
        this._emitChange();
      });
    });

    this.toolbar.querySelectorAll("select[data-cmd]").forEach((select) => {
      select.addEventListener("change", () => {
        this.surface.focus();
        document.execCommand(select.dataset.cmd, false, select.value);
        this._pushHistory();
        this._emitChange();
      });
    });
  }

  /** Text color / highlight — plain <input type="color"> swatches. */
  _wireColorControls() {
    this.toolbar.querySelectorAll('input[type="color"][data-cmd]').forEach((input) => {
      input.addEventListener("input", () => {
        this.surface.focus();
        const cmd = input.dataset.cmd;
        // Firefox uses "hiliteColor" for highlight; older Chromium builds
        // only understood "backColor". Try the standard one, fall back.
        try {
          document.execCommand(cmd, false, input.value);
        } catch (_) {
          if (cmd === "hiliteColor") document.execCommand("backColor", false, input.value);
        }
        this._pushHistory();
        this._emitChange();
      });
    });
  }

  /** Buttons that don't map onto execCommand (undo/redo, image, table popover). */
  _wireActionButtons() {
    this.toolbar.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        switch (btn.dataset.action) {
          case "undo": this.undo(); break;
          case "redo": this.redo(); break;
          case "insertImage": this.toolbar.querySelector("[data-image-input]").click(); break;
          case "openTablePicker": this._toggleTablePicker(); break;
        }
      });
    });

    // Close the table popover when clicking anywhere outside it.
    document.addEventListener("click", (e) => {
      if (!e.target.closest('[data-popover="table"]') && !e.target.closest('[data-action="openTablePicker"]')) {
        this._closeTablePicker();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Table insertion (Word-style grid picker)
  // ---------------------------------------------------------------------

  _wireTablePicker() {
    const grid = this.toolbar.querySelector("[data-table-grid]");
    const label = this.toolbar.querySelector("[data-table-label]");
    const rows = 6;
    const cols = 8;

    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const cell = document.createElement("div");
        cell.className = "table-grid__cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.addEventListener("mouseenter", () => {
          const cells = grid.querySelectorAll(".table-grid__cell");
          cells.forEach((el) => {
            const active = Number(el.dataset.row) <= r && Number(el.dataset.col) <= c;
            el.classList.toggle("is-active", active);
          });
          label.textContent = `${r} x ${c}`;
        });
        cell.addEventListener("click", () => {
          this._insertTable(r, c);
          this._closeTablePicker();
        });
        grid.appendChild(cell);
      }
    }
  }

  _toggleTablePicker() {
    const popover = this.toolbar.querySelector('[data-popover="table"]');
    popover.classList.toggle("is-open");
  }

  _closeTablePicker() {
    const popover = this.toolbar.querySelector('[data-popover="table"]');
    if (popover) popover.classList.remove("is-open");
  }

  _insertTable(rows, cols) {
    this.surface.focus();
    let rowsHtml = "";
    for (let r = 0; r < rows; r++) {
      let cellsHtml = "";
      for (let c = 0; c < cols; c++) cellsHtml += "<td><br></td>";
      rowsHtml += `<tr>${cellsHtml}</tr>`;
    }
    const html = `<table class="rte-table"><tbody>${rowsHtml}</tbody></table><p><br></p>`;
    document.execCommand("insertHTML", false, html);
    this._pushHistory();
    this._emitChange();
  }

  /** Moves the caret between table cells on Tab / Shift+Tab, Word-style. */
  _handleTableTab(shiftKey) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;

    const anchor = sel.anchorNode;
    const cell = anchor?.nodeType === Node.TEXT_NODE
      ? anchor.parentElement?.closest("td, th")
      : anchor?.closest?.("td, th");
    if (!cell || !this.surface.contains(cell)) return false;

    const row = cell.parentElement;
    const cellsInRow = Array.from(row.children);
    const cellIndex = cellsInRow.indexOf(cell);
    let target = null;

    if (!shiftKey) {
      if (cellIndex < cellsInRow.length - 1) {
        target = cellsInRow[cellIndex + 1];
      } else {
        const nextRow = row.nextElementSibling;
        if (nextRow) {
          target = nextRow.children[0];
        } else {
          // Tabbing past the last cell adds a new row, like Word/Notion tables.
          const newRow = document.createElement("tr");
          cellsInRow.forEach(() => {
            const td = document.createElement("td");
            td.innerHTML = "<br>";
            newRow.appendChild(td);
          });
          row.parentElement.appendChild(newRow);
          target = newRow.children[0];
        }
      }
    } else if (cellIndex > 0) {
      target = cellsInRow[cellIndex - 1];
    } else if (row.previousElementSibling) {
      const prevCells = row.previousElementSibling.children;
      target = prevCells[prevCells.length - 1];
    }

    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      this._pushHistory();
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Image upload, drag, and resize
  // ---------------------------------------------------------------------

  _wireImageInput() {
    const input = this.toolbar.querySelector("[data-image-input]");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this._insertImage(reader.result);
        input.value = ""; // allow re-selecting the same file later
      };
      reader.readAsDataURL(file);
    });
  }

  _insertImage(dataUrl) {
    this.surface.focus();
    // The wrapper is contenteditable="false", which makes it an atomic block
    // inside the editable surface — the browser handles picking it up and
    // dragging it to a new position for free, the same way it would an <hr>.
    const html = `<span class="rte-image" contenteditable="false"><img src="${dataUrl}" alt="" /><span class="rte-image__handle" title="Drag to resize"></span></span>&nbsp;`;
    document.execCommand("insertHTML", false, html);
    this._bindImageHandles();
    this._pushHistory();
    this._emitChange();
  }

  /** Wires resize-drag + select behavior on any image wrappers not yet bound. */
  _bindImageHandles() {
    this.surface.querySelectorAll(".rte-image__handle:not([data-bound])").forEach((handle) => {
      handle.dataset.bound = "1";
      handle.addEventListener("mousedown", (e) => this._startImageResize(e, handle));
    });

    if (!this._imageSelectBound) {
      this._imageSelectBound = true;
      this.surface.addEventListener("click", (e) => {
        const wrap = e.target.closest(".rte-image");
        this.surface.querySelectorAll(".rte-image.is-selected").forEach((el) => {
          if (el !== wrap) el.classList.remove("is-selected");
        });
        if (wrap) wrap.classList.add("is-selected");
      });
    }
  }

  _startImageResize(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    const wrap = handle.closest(".rte-image");
    const img = wrap.querySelector("img");
    if (!img) return;

    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;
    const maxWidth = this.surface.getBoundingClientRect().width;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(maxWidth, Math.max(60, startWidth + delta));
      img.style.width = `${newWidth}px`;
      img.style.height = "auto";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this._pushHistory();
      this._emitChange();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------------
  // Toolbar state reflection
  // ---------------------------------------------------------------------

  /** Reflects current selection state (bold/italic/... pressed) on the toolbar. */
  _updateToolbarState() {
    const stateCmds = ["bold", "italic", "underline", "justifyLeft", "justifyCenter", "justifyRight", "insertUnorderedList", "insertOrderedList"];
    stateCmds.forEach((cmd) => {
      const btn = this.toolbar.querySelector(`button[data-cmd="${cmd}"]`);
      if (!btn) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (_) { active = false; }
      btn.classList.toggle("is-active", active);
    });
  }

  _updateHistoryButtons() {
    const undoBtn = this.toolbar.querySelector('[data-action="undo"]');
    const redoBtn = this.toolbar.querySelector('[data-action="redo"]');
    if (undoBtn) undoBtn.disabled = this._historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = this._historyIndex >= this._history.length - 1;
  }

  // ===========================================================================
  // Surface events
  // ===========================================================================

  _bindSurfaceEvents() {
    this.surface.addEventListener("input", () => {
      this._emitChange();
      this._scheduleHistoryPush();
    });
    this.surface.addEventListener("keyup", () => this._updateToolbarState());
    this.surface.addEventListener("mouseup", () => this._updateToolbarState());
    this.surface.addEventListener("focus", () => this._updateToolbarState());
    this.surface.addEventListener("keydown", (e) => this._handleKeydown(e));

    // Keep pasted content reasonably clean (strip inline styles/classes from
    // other websites/Word so pages don't inherit foreign fonts/colors).
    this.surface.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
  }

  _handleKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b" || key === "i" || key === "u") {
        e.preventDefault();
        document.execCommand(key === "b" ? "bold" : key === "i" ? "italic" : "underline", false, null);
        this._updateToolbarState();
        this._pushHistory();
        this._emitChange();
        return;
      }
      if (key === "z") { e.preventDefault(); this.undo(); return; }
      if (key === "y") { e.preventDefault(); this.redo(); return; }
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      this.redo();
      return;
    }

    if (e.key === "Tab") {
      const handled = this._handleTableTab(e.shiftKey);
      if (handled) e.preventDefault();
    }
  }

  // ===========================================================================
  // Change / history plumbing
  // ===========================================================================

  _emitChange() {
    clearTimeout(this._changeTimer);
    this._changeTimer = setTimeout(() => this.onChange(this.getHTML()), 250);
  }

  /** Coalesces rapid typing into a single undo step, the way word processors do. */
  _scheduleHistoryPush() {
    clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => this._pushHistory(), 450);
  }

  _pushHistory() {
    if (this._suppressHistory) return;
    const html = this.getHTML();
    if (this._history[this._historyIndex] === html) return;

    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push(html);
    if (this._history.length > this._historyLimit) {
      this._history.shift();
    } else {
      this._historyIndex++;
    }
    this._updateHistoryButtons();
  }

  _restoreHistory() {
    this._suppressHistory = true;
    this.surface.innerHTML = this._history[this._historyIndex];
    this._bindImageHandles();
    this._suppressHistory = false;
    this._updateHistoryButtons();
    this._updateToolbarState();
    this.onChange(this.getHTML());
  }
}
