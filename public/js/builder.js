(function () {
  const initial = window.__INIT__ || {};

  let state = normalizeState(initial);
  let activePageId = state.pages[0] ? state.pages[0].id : null;

  const dom = {};
  const modals = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindDom();
    bindEvents();
    modals.addPage = new bootstrap.Modal(dom.addPageModal);
    modals.json = new bootstrap.Modal(dom.jsonModal);
    render();
  }

  function bindDom() {
    dom.templateSelect = document.getElementById("templateSelect");
    dom.refreshBtn = document.getElementById("refreshBtn");
    dom.previewBtn = document.getElementById("previewBtn");
    dom.exportBtn = document.getElementById("exportBtn");
    dom.resetBtn = document.getElementById("resetBtn");
    dom.pageTree = document.getElementById("pageTree");
    dom.canvasPageTitle = document.getElementById("canvasPageTitle");
    dom.canvasPagePath = document.getElementById("canvasPagePath");
    dom.canvasSections = document.getElementById("canvasSections");
    dom.addSectionShortcut = document.getElementById("addSectionShortcut");
    dom.sectionTypeList = document.getElementById("sectionTypeList");
    dom.sectionCount = document.getElementById("sectionCount");
    dom.structureContent = document.getElementById("structureContent");
    dom.jsonState = document.getElementById("jsonState");
    dom.footerStatus = document.getElementById("footerStatus");
    dom.cacheStatus = document.getElementById("cacheStatus");
    dom.addPageBtn = document.getElementById("addPageBtn");
    dom.addPageModal = document.getElementById("addPageModal");
    dom.pageTitleInput = document.getElementById("pageTitleInput");
    dom.pageParentSelect = document.getElementById("pageParentSelect");
    dom.savePageBtn = document.getElementById("savePageBtn");
    dom.jsonModal = document.getElementById("jsonModal");
    dom.jsonModalBody = document.getElementById("jsonModalBody");
    dom.copyJsonBtn = document.getElementById("copyJsonBtn");
    dom.toastArea = document.getElementById("toastArea");
  }

  function bindEvents() {
    dom.pageTree.addEventListener("click", handlePageTreeClick);
    dom.canvasSections.addEventListener("click", handleSectionClick);
    dom.sectionTypeList.addEventListener("click", handleSectionTypeClick);
    dom.addPageBtn.addEventListener("click", openAddPageModal);
    dom.savePageBtn.addEventListener("click", savePage);
    dom.previewBtn.addEventListener("click", openPreview);
    dom.exportBtn.addEventListener("click", openExportModal);
    dom.copyJsonBtn.addEventListener("click", copyExportJson);
    dom.resetBtn.addEventListener("click", resetBuilder);
    dom.refreshBtn.addEventListener("click", refreshGithubData);
    dom.templateSelect.addEventListener("change", changeTemplate);
    dom.addSectionShortcut.addEventListener("click", addFirstAvailableSection);

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => setActiveView(button.dataset.view));
    });

    dom.addPageModal.addEventListener("shown.bs.modal", () => {
      dom.pageTitleInput.focus();
    });
  }

  function normalizeState(data) {
    return {
      site: data.site || {},
      pages: Array.isArray(data.pages) ? data.pages : [],
      sections: data.sections || {},
      sectionTypes: Array.isArray(data.sectionTypes) ? data.sectionTypes : [],
      templates: Array.isArray(data.templates) ? data.templates : [],
      selectedTemplate: data.selectedTemplate || (data.template && data.template.id) || null,
      template: data.template || {},
      theme: data.theme || {},
      cache: data.cache || {}
    };
  }

  function setState(nextState) {
    state = normalizeState(nextState);

    if (!state.pages.some((page) => page.id === activePageId)) {
      activePageId = state.pages[0] ? state.pages[0].id : null;
    }

    render();
  }

  function render() {
    renderPageTree();
    renderCanvas();
    renderSectionTypes();
    renderStructureView();
    renderJsonView();
    renderFooter();
  }

  function renderPageTree() {
    const children = new Map();
    state.pages.forEach((page) => {
      const key = page.parentId || "__root__";
      children.set(key, [...(children.get(key) || []), page]);
    });

    const roots = children.get("__root__") || [];
    const html = roots.map((page) => renderPageNode(page, children, 0)).join("");
    dom.pageTree.innerHTML = html || `<div class="empty-state">No pages</div>`;
  }

  function renderPageNode(page, children, depth) {
    const childPages = children.get(page.id) || [];
    const isActive = page.id === activePageId;
    const canDelete = page.path !== "/" && state.pages.length > 1;

    return `
      <div class="page-node">
        <div class="page-row" style="padding-left: ${depth * 12}px">
          <button class="page-button ${isActive ? "active" : ""}" type="button" data-action="select-page" data-page-id="${escapeAttr(page.id)}">
            <i class="bi bi-file-earmark"></i>
            <span class="min-w-0">
              <span class="page-title">${escapeHtml(page.title)}</span>
              <span class="page-path">${escapeHtml(page.path)}</span>
            </span>
          </button>
          <button class="btn btn-sm btn-outline-danger icon-button" type="button" data-action="delete-page" data-page-id="${escapeAttr(page.id)}" title="Delete page" ${canDelete ? "" : "disabled"}>
            <i class="bi bi-trash"></i>
          </button>
        </div>
        ${childPages.map((child) => renderPageNode(child, children, depth + 1)).join("")}
      </div>
    `;
  }

  function renderCanvas() {
    const page = getActivePage();

    if (!page) {
      dom.canvasPageTitle.textContent = "No page selected";
      dom.canvasPagePath.textContent = "";
      dom.canvasSections.innerHTML = `<div class="empty-state">Create a page to start building.</div>`;
      return;
    }

    const pageSections = state.sections[page.id] || [];
    dom.canvasPageTitle.textContent = page.title;
    dom.canvasPagePath.textContent = page.path;

    if (!pageSections.length) {
      dom.canvasSections.innerHTML = `<div class="empty-state">Add a section to this page.</div>`;
      return;
    }

    dom.canvasSections.innerHTML = pageSections
      .map((section, index) => renderSectionBlock(section, index, pageSections.length))
      .join("");
  }

  function renderSectionBlock(section, index, total) {
    const type = state.sectionTypes.find((sectionType) => sectionType.id === section.type);
    const icon = type ? type.icon : "bi-layout-three-columns";

    return `
      <article class="section-block" data-section-id="${escapeAttr(section.id)}">
        <header class="section-toolbar">
          <div class="section-title">
            <i class="bi ${escapeAttr(icon)}"></i>
            <span>${escapeHtml(section.title || humanize(section.type))}</span>
          </div>
          <div class="section-actions">
            <button class="btn btn-sm btn-outline-secondary icon-button" type="button" data-action="move-section" data-direction="up" data-section-id="${escapeAttr(section.id)}" title="Move up" ${index === 0 ? "disabled" : ""}>
              <i class="bi bi-arrow-up"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary icon-button" type="button" data-action="move-section" data-direction="down" data-section-id="${escapeAttr(section.id)}" title="Move down" ${index === total - 1 ? "disabled" : ""}>
              <i class="bi bi-arrow-down"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger icon-button" type="button" data-action="delete-section" data-section-id="${escapeAttr(section.id)}" title="Delete section">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </header>
        <div class="section-preview">
          ${renderLivePreview(section)}
        </div>
      </article>
    `;
  }

  function renderLivePreview(section) {
    const content = getSectionContent(section.type);

    if (!content || (typeof content === "object" && !Object.keys(content).length)) {
      return renderWireframePreview(section);
    }

    if (section.type === "header" || section.type === "hero") {
      return renderHeroPreview(section, content);
    }

    const items = extractItems(content);
    const title = pick(content, ["title", "heading", "name"], section.title);
    const text =
      typeof content === "string"
        ? content
        : pick(content, ["description", "text", "summary", "content"], "");

    return `
      <div>
        <div class="preview-title">${escapeHtml(title)}</div>
        ${text ? `<div class="preview-copy mb-3">${escapeHtml(text)}</div>` : ""}
        ${items.length ? renderMiniCards(items.slice(0, 6)) : renderKeyValuePreview(content)}
      </div>
    `;
  }

  function renderHeroPreview(section, content) {
    const title = pick(content, ["title", "heading", "name"], state.site.title || section.title);
    const text = pick(content, ["subtitle", "tagline", "description", "text"], state.site.description || "");

    return `
      <div class="preview-hero">
        <div class="preview-title">${escapeHtml(title)}</div>
        ${text ? `<div class="preview-copy">${escapeHtml(text)}</div>` : ""}
        <div class="d-flex gap-2 flex-wrap">
          <span class="btn btn-sm btn-primary disabled">Primary</span>
          <span class="btn btn-sm btn-outline-primary disabled">Secondary</span>
        </div>
      </div>
    `;
  }

  function renderMiniCards(items) {
    return `
      <div class="mini-grid">
        ${items
          .map((item) => {
            const value = typeof item === "object" ? item : { title: item };
            const title = pick(value, ["title", "name", "label", "heading"], "Item");
            const text = pick(value, ["description", "text", "summary", "content"], "");
            return `
              <div class="mini-card">
                <div class="mini-card-title">${escapeHtml(title)}</div>
                ${text ? `<div class="mini-card-text">${escapeHtml(truncate(text, 96))}</div>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderKeyValuePreview(content) {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return renderWireframePreview({ type: "generic" });
    }

    const entries = Object.entries(content)
      .filter(([, value]) => typeof value !== "object")
      .slice(0, 5);

    if (!entries.length) {
      return renderWireframePreview({ type: "generic" });
    }

    return `
      <div class="list-group list-group-flush border rounded">
        ${entries
          .map(
            ([key, value]) => `
              <div class="list-group-item d-flex justify-content-between gap-3">
                <span class="fw-semibold text-capitalize">${escapeHtml(key.replace(/[-_]/g, " "))}</span>
                <span class="text-secondary text-end">${escapeHtml(truncate(value, 80))}</span>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderWireframePreview(section) {
    return `
      <div class="preview-hero">
        <div class="preview-line" style="width: 42%; height: 12px; border-radius: 999px; background: #cdd9e8;"></div>
        <div class="preview-line" style="width: 72%; height: 10px; border-radius: 999px; background: #d9e4ef;"></div>
        <div class="mini-grid">
          <div class="mini-card"></div>
          <div class="mini-card"></div>
          <div class="mini-card"></div>
        </div>
      </div>
    `;
  }

  function renderSectionTypes() {
    dom.sectionCount.textContent = `${state.sectionTypes.length}`;

    if (!state.sectionTypes.length) {
      dom.sectionTypeList.innerHTML = `<div class="empty-state">No section keys found in data.json.</div>`;
      return;
    }

    dom.sectionTypeList.innerHTML = state.sectionTypes
      .map(
        (sectionType) => `
          <button class="section-type-button" type="button" data-action="add-section" data-section-type="${escapeAttr(sectionType.id)}">
            <i class="bi ${escapeAttr(sectionType.icon)}"></i>
            <span class="section-type-name">${escapeHtml(sectionType.name)}</span>
            <i class="bi bi-plus-lg text-primary"></i>
          </button>
        `
      )
      .join("");
  }

  function renderStructureView() {
    dom.structureContent.innerHTML = state.pages
      .map((page) => {
        const pageSections = state.sections[page.id] || [];
        return `
          <article class="structure-card">
            <header class="structure-card-header">
              <div>
                <div class="fw-bold">${escapeHtml(page.title)}</div>
                <div class="small text-secondary">${escapeHtml(page.path)}</div>
              </div>
              <span class="badge text-bg-light">${pageSections.length} sections</span>
            </header>
            <div class="structure-card-body">
              ${
                pageSections.length
                  ? pageSections
                      .map((section) => `<span class="badge rounded-pill text-bg-primary">${escapeHtml(section.title)}</span>`)
                      .join("")
                  : `<span class="text-secondary small">Empty</span>`
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderJsonView() {
    dom.jsonState.textContent = JSON.stringify(exportPayload(), null, 2);
  }

  function renderFooter() {
    const page = getActivePage();
    const sectionCount = page ? (state.sections[page.id] || []).length : 0;
    dom.footerStatus.textContent = page
      ? `${state.pages.length} pages, ${sectionCount} sections on ${page.title}`
      : "No page selected";
    dom.cacheStatus.textContent = state.cache && state.cache.loadedAt ? `GitHub loaded ${formatDate(state.cache.loadedAt)}` : "";
  }

  function handlePageTreeClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const pageId = button.dataset.pageId;
    if (button.dataset.action === "select-page") {
      activePageId = pageId;
      render();
    }

    if (button.dataset.action === "delete-page") {
      deletePage(pageId);
    }
  }

  function handleSectionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const sectionId = button.dataset.sectionId;

    if (action === "delete-section") {
      deleteSection(sectionId);
    }

    if (action === "move-section") {
      moveSection(sectionId, button.dataset.direction);
    }
  }

  function handleSectionTypeClick(event) {
    const button = event.target.closest("[data-action='add-section']");
    if (!button) return;
    addSection(button.dataset.sectionType);
  }

  function openAddPageModal() {
    dom.pageTitleInput.value = "";
    dom.pageParentSelect.innerHTML = `<option value="">No parent</option>${state.pages
      .map((page) => `<option value="${escapeAttr(page.id)}">${escapeHtml(page.title)}</option>`)
      .join("")}`;

    if (activePageId && state.pages.some((page) => page.id === activePageId)) {
      dom.pageParentSelect.value = activePageId;
    }

    modals.addPage.show();
  }

  async function savePage() {
    const title = dom.pageTitleInput.value.trim();
    if (!title) {
      toast("Add a page title first.", "warning");
      return;
    }

    dom.savePageBtn.disabled = true;

    try {
      const data = await apiFetch("/api/pages", {
        method: "POST",
        body: JSON.stringify({
          title,
          parentId: dom.pageParentSelect.value || null
        })
      });
      activePageId = data.pages[data.pages.length - 1].id;
      setState(data);
      modals.addPage.hide();
      toast("Page created.");
    } finally {
      dom.savePageBtn.disabled = false;
    }
  }

  async function deletePage(pageId) {
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) return;

    if (!window.confirm(`Delete ${page.title}? Child pages will be removed too.`)) {
      return;
    }

    const data = await apiFetch(`/api/pages/${encodeURIComponent(pageId)}`, {
      method: "DELETE"
    });
    setState(data);
    toast("Page deleted.");
  }

  async function addSection(type) {
    const page = getActivePage();
    if (!page) {
      toast("Select a page first.", "warning");
      return;
    }

    const data = await apiFetch("/api/sections", {
      method: "POST",
      body: JSON.stringify({ pageId: page.id, type })
    });
    setState(data);
    toast("Section added.");
  }

  function addFirstAvailableSection() {
    const first = state.sectionTypes[0];
    if (!first) {
      toast("No section types found in data.json.", "warning");
      return;
    }
    addSection(first.id);
  }

  async function deleteSection(sectionId) {
    const data = await apiFetch(`/api/sections/${encodeURIComponent(sectionId)}`, {
      method: "DELETE"
    });
    setState(data);
    toast("Section removed.");
  }

  async function moveSection(sectionId, direction) {
    const page = getActivePage();
    if (!page) return;

    const data = await apiFetch("/api/sections/reorder", {
      method: "POST",
      body: JSON.stringify({
        pageId: page.id,
        sectionId,
        direction
      })
    });
    setState(data);
  }

  function setActiveView(view) {
    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.classList.toggle("btn-light", !active);
    });

    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.remove("active");
    });

    const target = document.getElementById(`${view}View`);
    if (target) {
      target.classList.add("active");
    }

    renderJsonView();
  }

  function openPreview() {
    const page = getActivePage();
    const query = page ? `?page=${encodeURIComponent(page.id)}` : "";
    window.open(`/preview${query}`, "_blank", "noopener");
  }

  function openExportModal() {
    dom.jsonModalBody.textContent = JSON.stringify(exportPayload(), null, 2);
    modals.json.show();
  }

  async function copyExportJson() {
    const text = dom.jsonModalBody.textContent;

    try {
      await navigator.clipboard.writeText(text);
      toast("JSON copied.");
    } catch (error) {
      toast("Clipboard permission was not available.", "warning");
    }
  }

  async function changeTemplate() {
    const data = await apiFetch("/api/template", {
      method: "POST",
      body: JSON.stringify({ template: dom.templateSelect.value })
    });
    setState(data);
    toast("Template changed.");
  }

  async function refreshGithubData() {
    dom.refreshBtn.disabled = true;

    try {
      const data = await apiFetch("/api/refresh", {
        method: "POST"
      });
      setState(data);
      toast("GitHub data refreshed.");
    } finally {
      dom.refreshBtn.disabled = false;
    }
  }

  async function resetBuilder() {
    if (!window.confirm("Reset the builder and return to template selection?")) {
      return;
    }

    const result = await apiFetch("/reset", {
      method: "POST"
    });

    window.location.href = result.redirect || "/";
  }

  async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    let payload = null;
    const text = await response.text();

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      const message = payload && payload.error ? payload.error : "Request failed.";
      toast(message, "danger");
      throw new Error(message);
    }

    return payload;
  }

  function exportPayload() {
    return {
      site: state.site,
      selectedTemplate: state.template.id,
      pages: state.pages,
      sections: state.sections,
      sectionTypes: state.sectionTypes,
      theme: state.theme,
      cache: state.cache
    };
  }

  function getActivePage() {
    return state.pages.find((page) => page.id === activePageId) || state.pages[0] || null;
  }

  function getSectionContent(type) {
    return state.site && state.site.raw ? state.site.raw[type] : null;
  }

  function extractItems(content) {
    if (Array.isArray(content)) return content;
    if (!content || typeof content !== "object") return [];

    const keys = ["items", "cards", "features", "services", "list", "plans", "projects", "testimonials", "rows"];
    for (const key of keys) {
      if (Array.isArray(content[key])) {
        return content[key];
      }
    }

    return [];
  }

  function pick(value, keys, fallback) {
    if (!value || typeof value !== "object") return fallback;
    for (const key of keys) {
      if (value[key] !== undefined && value[key] !== null && String(value[key]).trim() !== "") {
        return value[key];
      }
    }
    return fallback;
  }

  function humanize(value) {
    return String(value || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function truncate(value, limit) {
    const text = String(value || "");
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
      }).format(new Date(value));
    } catch (error) {
      return value;
    }
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function toast(message, variant = "success") {
    const alert = document.createElement("div");
    alert.className = `alert alert-${variant} shadow-sm mb-0`;
    alert.setAttribute("role", "status");
    alert.textContent = message;
    dom.toastArea.appendChild(alert);

    window.setTimeout(() => {
      alert.remove();
    }, 2800);
  }
})();
