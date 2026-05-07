# Mini Website Builder

A Bootstrap mini website builder built with Express, EJS, JavaScript, Axios, and Netlify Functions. Website content and theme settings are loaded from GitHub-hosted JSON files:

- `data.json`
- `theme.json` optional

The builder lets users choose a template, manage pages and subpages, add sections from the GitHub data source, preview pages, and export the current builder state as JSON.

## Tech Stack

- EJS
- JavaScript
- Bootstrap 5
- Express.js
- Axios
- Netlify Functions
- GitHub data source

## Main Flow

```text
GitHub data.json + theme.json
  -> server.js
  -> EJS templates
  -> window.__INIT__
  -> public/js/builder.js
  -> preview/export
```

## Project Structure

```text
.
├── package.json
├── package-lock.json
├── server.js
├── netlify.toml
├── netlify/
│   └── functions/
│       └── server.js
├── public/
│   └── js/
│       └── builder.js
└── views/
    ├── builder.ejs
    ├── preview.ejs
    └── template-select.ejs
```

## Setup

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run the production server:

```bash
npm start
```

Run the Netlify placeholder build:

```bash
npm run build
```

## Scripts

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js",
  "build": "node -e \"console.log('Netlify build uses the Express serverless function.')\""
}
```

## GitHub Data Source

By default the app loads content from:

```text
https://github.com/tinitiateprime/tech-stack-data.json
```

The server fetches:

```text
data.json
theme.json
```

You can override the source with environment variables:

```bash
GITHUB_DATA_REPO=https://github.com/owner/repository
GITHUB_DATA_BRANCH=main
GITHUB_DATA_FOLDER=folder-name
GITHUB_CACHE_MS=300000
```

Example PowerShell:

```powershell
$env:GITHUB_DATA_REPO="https://github.com/owner/repository"
$env:GITHUB_DATA_BRANCH="main"
npm run dev
```

## Expected `data.json`

The app supports flexible JSON, but these keys are useful:

```json
{
  "site": {
    "title": "My Website",
    "description": "A short website description"
  },
  "navbar": {
    "brand": "My Website",
    "links": [
      { "title": "Home", "path": "/" },
      { "title": "About", "path": "/about" },
      { "title": "Contact", "path": "/contact" }
    ]
  },
  "pages": [
    { "id": "home", "title": "Home", "path": "/" },
    { "id": "contact", "title": "Contact", "path": "/contact" },
    { "id": "support", "title": "Support", "path": "/contact/support", "parentId": "contact" }
  ],
  "hero": {
    "title": "Build faster",
    "description": "Content comes directly from GitHub JSON."
  },
  "about": {
    "title": "About us",
    "description": "A short about section."
  },
  "services": {
    "title": "Services",
    "items": [
      { "title": "Design", "description": "UI and UX work." },
      { "title": "Development", "description": "Web application builds." }
    ]
  },
  "footer": {
    "brand": "My Website",
    "tagline": "Built with Bootstrap",
    "copyright": "Copyright 2026 My Website.",
    "links": [
      {
        "group": "Company",
        "items": [
          { "label": "About", "path": "/about" },
          { "label": "Contact", "path": "/contact" }
        ]
      }
    ]
  }
}
```

Top-level keys such as `hero`, `about`, `services`, `features`, `pricing`, `catalog`, and `contact` become available section types in the builder.

Reserved keys are not treated as page sections:

```text
site, meta, metadata, seo, settings, config, theme, themes, styles,
navbar, nav, navigation, pages, routes, footer, copyright, social, assets
```

## Expected `theme.json`

`theme.json` is optional. If it is missing, default theme values are used.

```json
{
  "colors": {
    "primary": "#2563eb",
    "secondary": "#0f766e",
    "accent": "#f59e0b",
    "background": "#ffffff",
    "surface": "#f8fafc",
    "text": "#0f172a",
    "muted": "#64748b",
    "border": "#dbe4ef"
  },
  "typography": {
    "headingFont": "Inter, system-ui, sans-serif",
    "bodyFont": "Inter, system-ui, sans-serif"
  },
  "layout": {
    "radius": "0.5rem",
    "container": "1140px"
  }
}
```

## Pages And Subpages

Pages can be created from the builder. If a page has subpages, the preview navbar renders the parent page as a Bootstrap dropdown.

Subpages are detected by:

- `parentId`
- nested paths such as `/contact/support`

Example:

```json
[
  { "id": "contact", "title": "Contact", "path": "/contact" },
  { "id": "support", "title": "Support", "path": "/contact/support", "parentId": "contact" }
]
```

In preview, `Support` appears inside the `Contact` dropdown instead of beside it in the navbar.

## Routes

Browser routes:

```text
GET  /                  Template selector or builder
GET  /preview           Preview selected page
GET  /about             Dynamic preview route for matching pages
```

API routes:

```text
GET    /api/data
GET    /api/export
POST   /select-template
POST   /reset
POST   /api/refresh
POST   /api/template
POST   /api/pages
DELETE /api/pages/:id
POST   /api/sections
DELETE /api/sections/:id
POST   /api/sections/reorder
```

## Netlify Deployment

Netlify uses `netlify/functions/server.js` to wrap the Express app with `serverless-http`.

`netlify.toml`:

```toml
[build]
command = "npm run build"
publish = "public"
functions = "netlify/functions"

[functions]
included_files = ["views/**", "public/**", "server.js", "package.json"]

[[redirects]]
from = "/*"
to = "/.netlify/functions/server"
status = 200
```

## Port 3000 Already In Use

If you see this error:

```text
Error: listen EADDRINUSE: address already in use :::3000
```

Find and stop the process using port `3000`.

PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object {
  Stop-Process -Id $_.OwningProcess -Force
}
```

Git Bash:

```bash
netstat -ano | findstr :3000
taskkill //PID <PID> //F
```

Or run on another port:

```powershell
$env:PORT=3001
npm run dev
```

Then open:

```text
http://localhost:3001
```

## Notes

- The app keeps builder state in memory.
- Restarting the server resets the in-memory builder state.
- GitHub JSON is cached for a short duration to reduce repeated remote requests.
- Use `/api/refresh` or the Refresh button in the builder to reload GitHub data.
