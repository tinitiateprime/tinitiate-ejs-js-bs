const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const app = express();
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT || DEFAULT_PORT);

function projectPath(...parts) {
  const candidates = [
    path.join(__dirname, ...parts),
    path.join(process.cwd(), ...parts),
    path.join(__dirname, "..", "..", ...parts)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

const appState = {
  selectedTemplate: null,
  pages: [],
  sections: {},
  site: null,
  theme: null,
  rawData: null,
  sectionTypes: []
};

const DEFAULT_REPO_URL =
  process.env.GITHUB_DATA_REPO || "https://github.com/tinitiateprime/tech-stack-data.json";
const DEFAULT_BRANCH = process.env.GITHUB_DATA_BRANCH || "master";
const DEFAULT_FOLDER = process.env.GITHUB_DATA_FOLDER || "";
const CACHE_MS = Number(process.env.GITHUB_CACHE_MS || 5 * 60 * 1000);

let githubCache = {
  expiresAt: 0,
  loadedAt: null,
  data: null,
  theme: null,
  source: null
};

const RESERVED_SECTION_KEYS = new Set([
  "site",
  "meta",
  "metadata",
  "seo",
  "settings",
  "config",
  "theme",
  "themes",
  "styles",
  "navbar",
  "nav",
  "navigation",
  "pages",
  "routes",
  "footer",
  "copyright",
  "social",
  "assets"
]);

const DEFAULT_THEME = {
  colors: {
    primary: "#2563eb",
    secondary: "#0f766e",
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    muted: "#64748b",
    border: "#dbe4ef"
  },
  typography: {
    headingFont: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    bodyFont: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  },
  layout: {
    radius: "0.5rem",
    container: "1140px"
  }
};

const TEMPLATES = [
  {
    id: "clean-bootstrap",
    name: "Clean Bootstrap",
    description: "A crisp business layout with balanced spacing and classic Bootstrap components.",
    icon: "bi-layout-text-window-reverse",
    accent: "primary"
  },
  {
    id: "modern-saas",
    name: "Modern SaaS",
    description: "A compact product-site style with stronger contrast and feature cards.",
    icon: "bi-columns-gap",
    accent: "info"
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "A content-forward layout for service pages, guides, and portfolios.",
    icon: "bi-newspaper",
    accent: "success"
  }
];

app.engine("ejs", ejs.__express);
app.set("view engine", "ejs");
app.set("views", projectPath("views"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(projectPath("public")));

function cloneJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function parseJsonPayload(value, fallback = {}) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  if (value && typeof value === "object") {
    return cloneJson(value);
  }

  return fallback;
}

function parseGitHubRepoUrl(repoUrl = DEFAULT_REPO_URL) {
  let value = String(repoUrl || DEFAULT_REPO_URL).trim().replace(/\.git$/, "");

  if (value.startsWith("git@github.com:")) {
    value = `https://github.com/${value.slice("git@github.com:".length)}`;
  }

  if (!/^https?:\/\//i.test(value)) {
    value = `https://github.com/${value}`;
  }

  const parsed = new URL(value);
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error("GitHub repository URL must include owner and repository name.");
  }

  let branch = DEFAULT_BRANCH;
  let folder = DEFAULT_FOLDER.replace(/^\/+|\/+$/g, "");
  const treeIndex = parts.indexOf("tree");

  if (treeIndex >= 0) {
    branch = parts[treeIndex + 1] || branch;
    folder = parts.slice(treeIndex + 2).join("/");
  }

  return {
    owner: parts[0],
    repo: parts[1],
    branch,
    folder,
    repositoryUrl: `https://github.com/${parts[0]}/${parts[1]}`
  };
}

function encodeGitHubPath(filePath) {
  return filePath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function githubRawUrl(repoInfo, fileName) {
  const fullPath = [repoInfo.folder, fileName].filter(Boolean).join("/");
  return `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${encodeURIComponent(
    repoInfo.branch
  )}/${encodeGitHubPath(fullPath)}`;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sectionIcon(type) {
  const icons = {
    header: "bi-window",
    hero: "bi-stars",
    about: "bi-info-circle",
    services: "bi-grid-3x3-gap",
    features: "bi-ui-checks-grid",
    pricing: "bi-tags",
    portfolio: "bi-kanban",
    projects: "bi-kanban",
    testimonials: "bi-chat-quote",
    contact: "bi-envelope",
    comparison: "bi-table",
    faq: "bi-question-circle"
  };

  return icons[type] || "bi-layout-three-columns";
}

function hasRenderableValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return String(value).trim().length > 0;
}

function shouldRenderAsSection(key, value) {
  return !RESERVED_SECTION_KEYS.has(key) && hasRenderableValue(value);
}

function createRawGithubUrls() {
  const repoInfo = parseGitHubRepoUrl(DEFAULT_REPO_URL);
  return {
    repoInfo,
    dataUrl: githubRawUrl(repoInfo, "data.json"),
    themeUrl: githubRawUrl(repoInfo, "theme.json")
  };
}

async function fetchGithubJson(url, optional = false) {
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      responseType: "json",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "mini-website-builder"
      },
      validateStatus: (status) => (optional && status === 404) || (status >= 200 && status < 300)
    });

    if (optional && response.status === 404) {
      return null;
    }

    return parseJsonPayload(response.data, {});
  } catch (error) {
    if (optional && error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

async function fetchGithubFiles({ force = false } = {}) {
  const now = Date.now();
  if (!force && githubCache.data && githubCache.expiresAt > now) {
    return githubCache;
  }

  const source = createRawGithubUrls();
  const [data, theme] = await Promise.all([
    fetchGithubJson(source.dataUrl),
    fetchGithubJson(source.themeUrl, true)
  ]);

  githubCache = {
    expiresAt: now + CACHE_MS,
    loadedAt: new Date().toISOString(),
    data,
    theme,
    source
  };

  return githubCache;
}

function clearGithubCache() {
  githubCache = {
    expiresAt: 0,
    loadedAt: null,
    data: null,
    theme: null,
    source: null
  };
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "page";
}

function ensureUniqueId(base, existingIds) {
  let id = slugify(base);
  let index = 2;

  while (existingIds.has(id)) {
    id = `${slugify(base)}-${index}`;
    index += 1;
  }

  existingIds.add(id);
  return id;
}

function normalizePath(value, fallbackSlug, index = 0) {
  if (value && String(value).trim()) {
    const clean = String(value).trim();
    return clean.startsWith("/") ? clean : `/${clean}`;
  }

  return index === 0 ? "/" : `/${slugify(fallbackSlug)}`;
}

function normalizeNavbarLinks(data) {
  const links =
    data.navbar?.links || data.nav?.links || data.navigation?.links || data.menu?.links || [];

  if (!Array.isArray(links)) {
    return [];
  }

  return links.map((link) => {
    if (typeof link === "string") {
      return { title: titleCase(link), path: `/${slugify(link)}` };
    }

    return {
      title: link.title || link.label || link.name || "Page",
      path: link.path || link.href || link.url,
      sourceKey: link.section || link.key || link.type
    };
  });
}

function createDefaultPages(data) {
  const existingIds = new Set();
  let sourcePages = [];

  if (Array.isArray(data.pages) && data.pages.length > 0) {
    sourcePages = data.pages;
  } else {
    sourcePages = normalizeNavbarLinks(data);
  }

  if (!sourcePages.length) {
    sourcePages = [{ title: "Home", path: "/" }];
  }

  return sourcePages.map((rawPage, index) => {
    const raw = typeof rawPage === "string" ? { title: rawPage } : rawPage || {};
    const title = raw.title || raw.label || raw.name || (index === 0 ? "Home" : "Page");
    const id = ensureUniqueId(raw.id || raw.slug || title, existingIds);
    const pagePath = normalizePath(raw.path || raw.href || raw.url, title, index);

    return {
      id,
      title,
      path: pagePath,
      parentId: raw.parentId || raw.parent || null,
      sourceKey: raw.sourceKey || raw.section || raw.key || null,
      sections: Array.isArray(raw.sections) ? raw.sections : null
    };
  });
}

function createSectionTypes(data) {
  const order = [
    "header",
    "hero",
    "about",
    "services",
    "features",
    "pricing",
    "portfolio",
    "projects",
    "testimonials",
    "comparison",
    "faq",
    "contact"
  ];

  const keys = Object.keys(data || {}).filter((key) => shouldRenderAsSection(key, data[key]));
  keys.sort((a, b) => {
    const left = order.indexOf(a);
    const right = order.indexOf(b);

    if (left >= 0 && right >= 0) return left - right;
    if (left >= 0) return -1;
    if (right >= 0) return 1;
    return a.localeCompare(b);
  });

  return keys.map((key) => ({
    id: key,
    name: titleCase(key),
    icon: sectionIcon(key),
    hasContent: true
  }));
}

function createSection(pageId, type, existingSections = []) {
  const existingIds = new Set(existingSections.map((section) => section.id));
  const id = ensureUniqueId(`${pageId}-${type}`, existingIds);

  return {
    id,
    pageId,
    type,
    title: titleCase(type)
  };
}

function normalizeExplicitSections(page, sectionTypes) {
  if (!Array.isArray(page.sections)) {
    return [];
  }

  const allowed = new Set(sectionTypes.map((sectionType) => sectionType.id));

  return page.sections
    .map((section) => {
      if (typeof section === "string") {
        return { type: section };
      }
      return section || {};
    })
    .filter((section) => section.type && allowed.has(section.type))
    .map((section) => ({
      id: section.id || null,
      pageId: page.id,
      type: section.type,
      title: section.title || titleCase(section.type)
    }));
}

function createDefaultSectionsForPage(page, data, sectionTypes) {
  const explicit = normalizeExplicitSections(page, sectionTypes);
  if (explicit.length) {
    const existingIds = new Set();
    return explicit.map((section) => ({
      ...section,
      id: ensureUniqueId(section.id || `${page.id}-${section.type}`, existingIds)
    }));
  }

  const available = new Set(sectionTypes.map((sectionType) => sectionType.id));
  const pageSlug = slugify(page.sourceKey || page.title || page.id);
  const isHome = page.path === "/" || page.id === "home" || pageSlug === "home";
  const preferred = [];

  if (isHome) {
    ["header", "hero", "about", "services", "features", "pricing", "testimonials", "contact"]
      .filter((type) => available.has(type))
      .forEach((type) => preferred.push(type));
  } else {
    [page.sourceKey, pageSlug, slugify(page.id)]
      .filter(Boolean)
      .forEach((type) => {
        if (available.has(type) && !preferred.includes(type)) {
          preferred.push(type);
        }
      });
  }

  if (!preferred.length) {
    ["about", "services", "features", "portfolio", "projects", "contact"]
      .filter((type) => available.has(type))
      .slice(0, isHome ? 4 : 2)
      .forEach((type) => preferred.push(type));
  }

  if (!preferred.length) {
    sectionTypes.slice(0, isHome ? 4 : 1).forEach((sectionType) => preferred.push(sectionType.id));
  }

  return preferred.map((type, index) => ({
    id: `${page.id}-${type}-${index + 1}`,
    pageId: page.id,
    type,
    title: titleCase(type)
  }));
}

function normalizeTheme(themeJson) {
  const raw = parseJsonPayload(themeJson, {});
  const theme = cloneJson(DEFAULT_THEME);

  if (raw.colors && typeof raw.colors === "object") {
    theme.colors = { ...theme.colors, ...raw.colors };
  }

  if (raw.typography && typeof raw.typography === "object") {
    theme.typography = { ...theme.typography, ...raw.typography };
  }

  if (raw.layout && typeof raw.layout === "object") {
    theme.layout = { ...theme.layout, ...raw.layout };
  }

  ["primary", "secondary", "accent", "background", "surface", "text", "muted", "border"].forEach(
    (key) => {
      if (raw[key]) {
        theme.colors[key] = raw[key];
      }
    }
  );

  theme.cssVars = {
    "--site-primary": theme.colors.primary,
    "--site-secondary": theme.colors.secondary,
    "--site-accent": theme.colors.accent,
    "--site-bg": theme.colors.background,
    "--site-surface": theme.colors.surface,
    "--site-text": theme.colors.text,
    "--site-muted": theme.colors.muted,
    "--site-border": theme.colors.border,
    "--site-heading-font": theme.typography.headingFont,
    "--site-body-font": theme.typography.bodyFont,
    "--site-radius": theme.layout.radius,
    "--site-container": theme.layout.container
  };

  return theme;
}

function createSiteData(data, theme, source) {
  const site = data.site || data.business || data.company || {};
  const navbar = data.navbar || data.nav || data.navigation || {};

  return {
    title: site.title || site.name || navbar.brand || data.title || "Mini Website",
    description:
      site.description || site.tagline || data.description || "A GitHub powered Bootstrap website.",
    brand: navbar.brand || site.name || site.title || data.title || "Mini Website",
    raw: cloneJson(data),
    theme,
    source: {
      repository: source.repoInfo.repositoryUrl,
      branch: source.repoInfo.branch,
      folder: source.repoInfo.folder,
      dataUrl: source.dataUrl,
      themeUrl: source.themeUrl,
      loadedAt: githubCache.loadedAt
    }
  };
}

function buildBuilderModel(data, themeJson, source) {
  const theme = normalizeTheme(themeJson);
  const pages = createDefaultPages(data);
  const sectionTypes = createSectionTypes(data);
  const sections = {};

  pages.forEach((page) => {
    sections[page.id] = createDefaultSectionsForPage(page, data, sectionTypes);
  });

  return {
    site: createSiteData(data, theme, source),
    theme,
    pages,
    sections,
    sectionTypes,
    rawData: cloneJson(data)
  };
}

async function loadApplicationData({ force = false, resetState = false } = {}) {
  const files = await fetchGithubFiles({ force });
  const model = buildBuilderModel(files.data, files.theme, files.source);

  appState.site = model.site;
  appState.theme = model.theme;
  appState.rawData = model.rawData;
  appState.sectionTypes = model.sectionTypes;

  if (resetState || !appState.pages.length) {
    appState.pages = model.pages;
    appState.sections = model.sections;
  }

  return buildClientData();
}

function getTemplateOptions() {
  return cloneJson(TEMPLATES);
}

function getSelectedTemplate() {
  return TEMPLATES.find((template) => template.id === appState.selectedTemplate) || TEMPLATES[0];
}

function buildClientData() {
  return {
    site: appState.site,
    pages: appState.pages,
    sections: appState.sections,
    sectionTypes: appState.sectionTypes,
    templates: getTemplateOptions(),
    selectedTemplate: appState.selectedTemplate,
    template: getSelectedTemplate(),
    theme: appState.theme,
    cache: {
      loadedAt: githubCache.loadedAt,
      expiresAt: githubCache.expiresAt ? new Date(githubCache.expiresAt).toISOString() : null
    }
  };
}

function serializeForHtml(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    const replacements = {
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026"
    };
    return replacements[character];
  });
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function findPageById(pageId) {
  return appState.pages.find((page) => page.id === pageId);
}

function findPageByPath(pagePath) {
  const normalizedPath = normalizePath(pagePath, "home");
  return appState.pages.find((page) => page.path === normalizedPath);
}

function findPreviewPage(req) {
  const requestedPage = req.query.page || req.query.pageId;
  if (requestedPage) {
    const page = findPageById(requestedPage);
    if (page) return page;
  }

  const requestedPath = req.query.path || req.path;
  return findPageByPath(requestedPath) || appState.pages[0];
}

function renderPreview(req, res, page) {
  res.render("preview", {
    site: appState.site,
    page,
    pages: appState.pages,
    sections: appState.sections[page.id] || [],
    template: getSelectedTemplate(),
    theme: appState.theme,
    rawData: appState.rawData
  });
}

function collectPageAndChildren(pageId) {
  const ids = new Set([pageId]);
  let changed = true;

  while (changed) {
    changed = false;
    appState.pages.forEach((page) => {
      if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    });
  }

  return ids;
}

function updateStateFromClientData(clientData) {
  appState.pages = clientData.pages;
  appState.sections = clientData.sections;
}

app.get(
  "/",
  asyncRoute(async (req, res) => {
    const data = await loadApplicationData();

    if (!appState.selectedTemplate) {
      res.render("template-select", {
        templates: data.templates,
        selectedTemplate: data.template.id,
        site: data.site
      });
      return;
    }

    res.render("builder", {
      data,
      initialJson: serializeForHtml(data)
    });
  })
);

app.get(
  "/preview",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    renderPreview(req, res, findPreviewPage(req));
  })
);

app.post(
  "/select-template",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const templateId = req.body.template || req.body.templateId || req.body.id;

    if (!TEMPLATES.some((template) => template.id === templateId)) {
      res.status(400).json({ error: "Unknown template." });
      return;
    }

    appState.selectedTemplate = templateId;
    res.json({ ok: true, redirect: "/" });
  })
);

app.post(
  "/reset",
  asyncRoute(async (req, res) => {
    appState.selectedTemplate = null;
    appState.pages = [];
    appState.sections = {};
    await loadApplicationData({ resetState: true });
    res.json({ ok: true, redirect: "/" });
  })
);

app.post(
  "/api/refresh",
  asyncRoute(async (req, res) => {
    clearGithubCache();
    const data = await loadApplicationData({ force: true, resetState: true });
    res.json(data);
  })
);

app.post(
  "/api/template",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const templateId = req.body.template || req.body.templateId || req.body.id;

    if (!TEMPLATES.some((template) => template.id === templateId)) {
      res.status(400).json({ error: "Unknown template." });
      return;
    }

    appState.selectedTemplate = templateId;
    res.json(buildClientData());
  })
);

app.get(
  "/api/data",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    res.json(buildClientData());
  })
);

app.get(
  "/api/export",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    res.json(buildClientData());
  })
);

app.post(
  "/api/pages",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const title = String(req.body.title || "Untitled Page").trim();
    const parentId = req.body.parentId || null;

    if (parentId && !findPageById(parentId)) {
      res.status(400).json({ error: "Parent page does not exist." });
      return;
    }

    const existingIds = new Set(appState.pages.map((page) => page.id));
    const id = ensureUniqueId(req.body.id || title, existingIds);
    const parent = parentId ? findPageById(parentId) : null;
    const pathPrefix = parent && parent.path !== "/" ? parent.path : "";
    const pagePath = req.body.path || `${pathPrefix}/${slugify(title)}`;
    const page = {
      id,
      title,
      path: normalizePath(pagePath, title, appState.pages.length),
      parentId,
      sourceKey: req.body.sourceKey || null,
      sections: null
    };

    appState.pages.push(page);
    appState.sections[page.id] = createDefaultSectionsForPage(page, appState.rawData, appState.sectionTypes);
    res.status(201).json(buildClientData());
  })
);

app.delete(
  "/api/pages/:id",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const page = findPageById(req.params.id);

    if (!page) {
      res.status(404).json({ error: "Page not found." });
      return;
    }

    if (appState.pages.length <= 1 || page.path === "/") {
      res.status(400).json({ error: "The home page cannot be removed." });
      return;
    }

    const idsToRemove = collectPageAndChildren(page.id);
    appState.pages = appState.pages.filter((candidate) => !idsToRemove.has(candidate.id));
    idsToRemove.forEach((id) => delete appState.sections[id]);
    res.json(buildClientData());
  })
);

app.post(
  "/api/sections",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const pageId = req.body.pageId;
    const type = req.body.type;
    const page = findPageById(pageId);

    if (!page) {
      res.status(404).json({ error: "Page not found." });
      return;
    }

    if (!appState.sectionTypes.some((sectionType) => sectionType.id === type)) {
      res.status(400).json({ error: "Unknown section type." });
      return;
    }

    appState.sections[pageId] = appState.sections[pageId] || [];
    appState.sections[pageId].push(createSection(pageId, type, appState.sections[pageId]));
    res.status(201).json(buildClientData());
  })
);

app.delete(
  "/api/sections/:id",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    let removed = false;

    Object.keys(appState.sections).forEach((pageId) => {
      const originalLength = appState.sections[pageId].length;
      appState.sections[pageId] = appState.sections[pageId].filter(
        (section) => section.id !== req.params.id
      );
      removed = removed || originalLength !== appState.sections[pageId].length;
    });

    if (!removed) {
      res.status(404).json({ error: "Section not found." });
      return;
    }

    res.json(buildClientData());
  })
);

app.post(
  "/api/sections/reorder",
  asyncRoute(async (req, res) => {
    await loadApplicationData();
    const pageId = req.body.pageId;
    const sectionId = req.body.sectionId;
    const pageSections = appState.sections[pageId] || [];

    if (Array.isArray(req.body.orderedIds)) {
      const byId = new Map(pageSections.map((section) => [section.id, section]));
      const ordered = req.body.orderedIds.map((id) => byId.get(id)).filter(Boolean);
      const remaining = pageSections.filter((section) => !req.body.orderedIds.includes(section.id));
      appState.sections[pageId] = [...ordered, ...remaining];
      res.json(buildClientData());
      return;
    }

    const index = pageSections.findIndex((section) => section.id === sectionId);
    if (index < 0) {
      res.status(404).json({ error: "Section not found." });
      return;
    }

    const direction = req.body.direction === "down" ? 1 : -1;
    const nextIndex = index + direction;

    if (nextIndex >= 0 && nextIndex < pageSections.length) {
      const next = pageSections[nextIndex];
      pageSections[nextIndex] = pageSections[index];
      pageSections[index] = next;
    }

    res.json(buildClientData());
  })
);

app.get(
  /^\/(?!api\/|js\/|css\/|images\/|preview$|favicon\.ico$).+/,
  asyncRoute(async (req, res, next) => {
    await loadApplicationData();
    const page = findPageByPath(req.path);

    if (!page) {
      next();
      return;
    }

    renderPreview(req, res, page);
  })
);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Route not found." });
    return;
  }

  res.status(404).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Page not found</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <main class="container py-5">
          <div class="border rounded bg-white p-4">
            <p class="text-uppercase text-secondary small fw-semibold mb-2">404</p>
            <h1 class="h3">Page not found</h1>
            <a class="btn btn-primary mt-3" href="/">Back to builder</a>
          </div>
        </main>
      </body>
    </html>
  `);
});

app.use((error, req, res, next) => {
  const status = error.response?.status || error.status || 500;
  const message =
    error.response?.status === 404
      ? "Could not find data.json in the configured GitHub repository."
      : error.message || "Unexpected server error.";

  if (req.path.startsWith("/api/")) {
    res.status(status).json({ error: message });
    return;
  }

  res.status(status).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Builder error</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <main class="container py-5">
          <div class="border rounded bg-white p-4">
            <p class="text-uppercase text-danger small fw-semibold mb-2">Error</p>
            <h1 class="h3">The builder could not load.</h1>
            <p class="text-secondary">${message}</p>
            <p class="small text-secondary mb-0">Check GITHUB_DATA_REPO, GITHUB_DATA_BRANCH, or the remote data.json file.</p>
          </div>
        </main>
      </body>
    </html>
  `);
});

module.exports = app;

if (require.main === module) {
  const allowPortFallback = !process.env.PORT;

  function startServer(port, remainingAttempts = 10) {
    const server = app.listen(port, () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      console.log(`Mini website builder running at http://localhost:${activePort}`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE" && allowPortFallback && remainingAttempts > 0) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is already in use. Trying http://localhost:${nextPort}`);
        startServer(nextPort, remainingAttempts - 1);
        return;
      }

      if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop that process or set PORT to another value.`);
      } else {
        console.error(error);
      }

      process.exit(1);
    });
  }

  startServer(PORT);
}
