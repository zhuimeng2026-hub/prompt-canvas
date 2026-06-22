<div align="center">

# Prompt Canvas

### A local Codex plugin that turns AI image iteration from "scrolling through chat history" into "managing versions on a canvas"

Manage every version of your AI-generated images (v1→v2→v3) on a canvas, drive Codex to generate the next version through screenshots, structured annotations, or conversational instructions — all stored locally in SQLite.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Codex Plugin](https://img.shields.io/badge/Codex-Plugin-111827)](#installation-and-startup)
[![MCP Tools](https://img.shields.io/badge/MCP-Tools-2563eb)](./.mcp.json)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](./package.json)
[![npm](https://img.shields.io/badge/npm-ready-cb3837)](./package.json)
[![English](https://img.shields.io/badge/lang-English-0284c7)](./README.en.md)
[![中文](https://img.shields.io/badge/lang-中文-dc2626)](./README.md)

**English** · [中文](./README.md)

[Quick Start](#quick-start) · [Installation](#installation-and-startup) · [Capabilities](#core-capabilities) · [Interaction Flow](#core-interaction-flow) · [How It Works](#how-it-works) · [Environment Variables](#environment-variables)

</div>

## What is this?

Prompt Canvas is a local-first Codex plugin. It lets Codex open an infinite tldraw-based canvas, generate images for you, read your arrows, scribbles, and text annotations on those images, and then place the revised version to the right of the original.

You can think of it as:

**An AI drawing whiteboard inside Codex.**

Regular users do not need to understand MCP, shapes, holders, or local file paths. Just describe what you want, open the canvas, annotate your changes, and let Codex generate the next version.

## Core Capabilities

| Capability | Description |
|---|---|
| Natural language image generation | Ask Codex to generate ads, covers, posters, product shots, or visual concepts |
| Local infinite canvas | A tldraw-based local canvas with infinite zoom and persistent annotations |
| Annotation-driven editing | Arrows, text, and scribbles are interpreted as structured revision instructions |
| Version history preserved | New versions are placed to the right of the original for easy comparison and iteration |
| Local-first | Canvas data lives in the current project directory; no cloud backend required |

## Quick Start

1. Tell Codex in chat: "Make me a ramen ad"
2. Codex opens the local canvas, creates an AI Image Holder, and generates the image
3. Draw arrows, write text, or circle areas on the generated image to request changes
4. Say "revise based on my annotations" — Codex reads the annotations and generates a new version
5. The new version appears on the right; the old version is kept for comparison

## Installation and Startup

### Use as a Codex Plugin (Recommended)

This repository is structured as a standard Codex plugin and can be distributed directly via GitHub.

#### 1. Add the Marketplace (one-time)

Add this repository as a marketplace source in the Codex CLI:

```bash
codex plugin marketplace add lqshow/prompt-canvas
# or pin a branch/SHA
codex plugin marketplace add lqshow/prompt-canvas --ref main
```

Codex will read the plugin list from `.agents/plugins/marketplace.json` in this repository.

#### 2. Install and Enable the Plugin

1. Open the **Plugins** panel in Codex.
2. Select `prompt-canvas-marketplace` from the marketplace picker.
3. Find **Prompt Canvas** and click **Install** (or **Enable**).
4. Once installed, Codex will automatically load:
   - The skill instructions from `skills/prompt-canvas/SKILL.md`
   - The MCP server declared in `.mcp.json`

> If you are not using plugin mode, you can still register the MCP server manually:
> ```bash
> codex mcp add prompt-canvas -- python3 $(pwd)/mcp-server/prompt_canvas_mcp.py
> ```

#### 3. Configure Environment Variables (Optional)

The repository provides `.env.example` with a default port of `52846`. To change the port, copy it to `.env`:

```bash
cp .env.example .env
# edit .env to change PROMPT_CANVAS_PORT, etc.
```

All startup scripts (`start-canvas.sh`, `start-mcp.sh`), the Flask backend, the MCP server, and the Vite dev server will automatically read `.env`; if `.env` is absent, they fall back to `.env.example`. Real environment variables always take precedence.

#### 4. Install Dependencies and Build the Frontend

```bash
npm install
npm run build
```

#### 5. Start the Canvas Server

```bash
./scripts/start-canvas.sh /path/to/your/codex-project
```

The service will start at: `http://127.0.0.1:52846/`

Canvas data is written into the project directory:
- Page snapshot: `/path/to/your/codex-project/canvas/pages/<page>/prompt-canvas.json`
- Page assets: `/path/to/your/codex-project/canvas/pages/<page>/assets/`

### Local Development

```bash
# 1. Start the Flask backend
python3 server.py

# 2. Start the frontend in dev mode (Vite dev server proxies /api to Flask)
npm run dev

# 3. Open in browser
open http://127.0.0.1:5173/canvas/
```

## Core Interaction Flow

1. Ask Codex to create an AI Image Holder in Prompt Canvas
2. Codex calls `linyuebanzi-image-gen` (or another image generator) to create the image and place it on the canvas
3. The user draws annotations (arrows, circles, text) on the image to express revision intent
4. The user clicks "Submit to Codex" or copies the annotation instructions
5. Codex reads the structured annotation markdown and generates a new version
6. The new version appears on the canvas; iteration continues

## How It Works

- **Skills** (`skills/`): Codex skill instructions for opening the canvas, generating images, and annotation-driven revisions
- **MCP server** (`mcp-server/prompt_canvas_mcp.py`): Exposes canvas capabilities as Codex-callable tools
- **Local Web App** (`canvas/`): tldraw-based canvas UI embedded in the Codex browser
- **Local Service** (`server.py`): Flask backend with REST API, SSE, and SQLite persistence
- **Codex**: Understands user intent, calls image-generation skills, and fills results back into the canvas

## File Structure

```
.
├── .agents/
│   └── plugins/
│       └── marketplace.json     # Codex marketplace entry
├── .codex-plugin/
│   └── plugin.json              # Codex plugin metadata
├── .env.example                 # Default environment variables (committed)
├── .mcp.json                    # MCP server registration
├── package.json                 # npm / Vite build config
├── vite.config.js               # Vite config
├── server.py                    # Flask backend: REST API + SSE + SQLite persistence
├── imagegen.py                  # Local mock image generator (fallback when no real API)
├── canvas/                      # Frontend canvas source (tldraw + custom AI Image shape)
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx             # React entry
│   │   └── styles.css           # Custom styles
│   ├── dist/                    # Vite build output
│   └── tldraw.css
├── scripts/
│   ├── start-canvas.sh          # Start canvas server
│   └── start-mcp.sh             # Start MCP server
├── mcp-server/
│   └── prompt_canvas_mcp.py     # MCP server invoked by Codex
├── skills/
│   └── prompt-canvas/           # Codex skill (canvas, generation, annotation editing)
├── canvas/pages/                # Project-local page data (assets and _pending)
└── .cowart.db                   # SQLite database (runtime, kept for backward compatibility)
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PROMPT_CANVAS_PROJECT_DIR` | Current Codex project directory | Current working directory |
| `PROMPT_CANVAS_CANVAS_DIR` | Canvas data directory | `$PROMPT_CANVAS_PROJECT_DIR/canvas` |
| `PROMPT_CANVAS_PORT` | Flask service port | `52846` |
| `PROMPT_CANVAS_HOST` | Flask bind address | `127.0.0.1` |

## Notes

- `.cowart.db`, `.cowart_state.json`, `canvas/pages/`, `canvas/dist/`, `node_modules/`, etc. are runtime data and are ignored by `.gitignore`
- Real image generation depends on Codex calling external skills (e.g. `linyuebanzi-image-gen`); local `imagegen.py` is only a mock fallback
- Generated images and pending submit files now live under `canvas/pages/<canvas>/assets/` and `canvas/pages/<canvas>/_pending/`; legacy `/generated/<canvas>/<file>` URLs are redirected to `/page-assets/<canvas>/<file>`
