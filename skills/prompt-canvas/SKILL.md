---
name: prompt-canvas
description: Drive the local Prompt Canvas from Codex for visual AI image iteration. Use when the user wants to open a local infinite canvas, generate images, place them on the canvas, and refine them by drawing annotations (arrows, scribbles, text) directly on the image. The canvas exposes MCP tools prefixed with `prompt_canvas_` (prompt_canvas_open, prompt_canvas_create_ai_image_holder, prompt_canvas_fill_ai_image_holder, prompt_canvas_read_annotations, prompt_canvas_insert_image, ...).
---

# Prompt Canvas

Prompt Canvas is a local-first infinite canvas for visual AI image iteration. The user opens the canvas URL in the Codex in-app browser, drops "AI Image" placeholder frames, asks Codex to fill them with generated images, and then draws annotations (red arrows, scribbles, text) directly on top of the image to request changes. Codex reads those annotations as structured, spatially-aware instructions and regenerates.

The whole system is local. The canvas is a tldraw-based board served on `http://127.0.0.1:52846`, state is persisted to SQLite (`.cowart.db`) and project-local `canvas/pages/<page>/prompt-canvas.json`, and Codex talks to it through MCP tools.

## Critical rule

**Whenever you generate an image for the user, you MUST place it in the Prompt Canvas and provide the canvas URL. Do not just return the image file or display it inline. The canvas is the primary workspace; the image only becomes editable/iterable once it is on the canvas.**

## Mental model

- The canvas lives at `http://127.0.0.1:52846/?canvas=<id>`. Each Codex thread should usually have its own canvas id.
- Everything on the canvas is a *shape*. The shape type that matters for image generation is:
  - `ai-image` — a framed box that can hold a generated image. It has `version` (v1, v2, ...), `label`, `w`, `h`, and optionally `image_url` when filled.
- The user draws annotations on top of an `ai-image` using tldraw's native tools (draw, arrow, text, geo). Those shapes get `meta.role = "annotation"` and `meta.target = <ai-image-id>`.
- `prompt_canvas_read_annotations` returns both the raw annotations and a `markdown` field: a human-readable list that includes each annotation's relative position on the image (e.g. "箭头指向顶部中央"). Use this markdown directly in the image-generation prompt.

## Required setup (one time)

1. Start the Prompt Canvas server. It serves the UI + REST API on port 52846:
   ```bash
   cd <project root>
   ./scripts/start-canvas.sh /path/to/your/codex-project
   ```
2. Have the user open `http://127.0.0.1:52846/` in the Codex in-app browser so they can see the board. If `prompt_canvas_open` reports the server is unreachable, start it with the command above.
3. The MCP server (`mcp-server/prompt_canvas_mcp.py`) must be registered with Codex:
   ```bash
   codex mcp add prompt-canvas -- python3 $(pwd)/mcp-server/prompt_canvas_mcp.py
   ```
   This is one-time setup; the agent does not need to do it mid-conversation.

## Standard workflow

### A. Filling an AI Image Holder (most common)

The user has already created or selected an `ai-image` shape and asks Codex to generate an image for it.

1. **Confirm the target** — call `prompt_canvas_get_state` or ask the user to select the shape.
   - If the user said "fill this", check the current selection via `prompt_canvas_get_selection` (returns the full shape list; pick the `ai-image`). Otherwise ask the user to click the target.
   - You need the shape's `id`, `w`, and `h`.
2. **Compute the aspect ratio** from `w / h`. The image you generate should match it.
3. **Generate the image** using `linyuebanzi-image-gen` (or the user's preferred image generator). The prompt should include the desired content and the aspect ratio.
4. **Put the generated image where the canvas can serve it.** If the generator wrote the file elsewhere (e.g. `cover-output/`), copy or move it into the page-local assets folder `canvas/pages/<canvas>/assets/` so the URL `/page-assets/<canvas>/<filename>` works.
5. **Fill the placeholder** with `prompt_canvas_fill_ai_image_holder`:
   ```json
   {
     "canvas_id": "<canvas id>",
     "shape_id": "<ai-image id>",
     "image_url": "/page-assets/<canvas>/<filename>.jpg",
     "prompt": "竖版 2:3 虚构品牌广告 ..."
   }
   ```
6. **Open the canvas for the user.** Call `prompt_canvas_open` to get the canvas URL, then present it clearly:
   > "图片已放入画布，打开链接查看：http://127.0.0.1:52846/?canvas=<canvas_id>"
   - The canvas will auto-sync via SSE and polling; if the user already has the canvas open, the new image should appear within a few seconds without manual refresh. Only ask them to refresh if it does not show up.
7. **Report back** with the shape id, final size, image URL, prompt, and the canvas URL.

### B. Iterating on a generated image with annotations

The user looks at the generated image, scribbles arrows / text / circles on top of it ("碗小一点", "用白汤", "logo 换到右下角"), then asks Codex to regenerate.

**Core rule: v2 is an EDIT of v1, not a fresh text-to-image generation.** You must feed the actual v1 pixels into the generator as a reference image and run it in `edit` mode. A prompt like "same composition as v1 but with curly hair" is NOT enough — text alone cannot preserve the face, pose, layout, and style. If you skip the reference image, the subject and composition will drift and the user's "只改这一处" intent is lost.

1. **Read the annotations** with `prompt_canvas_read_annotations`:
   ```json
   {
     "canvas_id": "<canvas id>",
     "shape_id": "<source ai-image id>"
   }
   ```
   The response contains `markdown` — a spatially-aware instruction list. Copy it verbatim into the image-generation prompt.
2. **Resolve the v1 source image to a local file.** Look at the source `ai-image` shape's `image_url` (from `prompt_canvas_get_state`) and map it to a real file on disk:
   - `/page-assets/<canvas>/<file>` → `canvas/pages/<canvas>/assets/<file>`
   - Legacy `/generated/<canvas>/<file>` URLs redirect to `/page-assets/<canvas>/<file>`.
   If the shape has no `image_url`, it was never filled — stop and ask the user which image to base v2 on.
3. **Turn the v1 file into a reference the generator can fetch.** The image generators send the reference over the network, so a local path or a `127.0.0.1` URL will NOT work. Convert the v1 file to a base64 data URI:
   ```bash
   python3 -c "import base64,sys,mimetypes; p=sys.argv[1]; m=mimetypes.guess_type(p)[0] or 'image/jpeg'; print(f'data:{m};base64,'+base64.b64encode(open(p,'rb').read()).decode())" "canvas/pages/<canvas>/assets/<v1file>" > /tmp/v1-ref.txt
   ```
   (If the provider rejects data URIs, upload v1 to an image host and use that public URL instead.)
4. **Create a new version holder** with `prompt_canvas_create_ai_image_holder`, placed to the right of (or below) the source image (e.g. `x = source.x + source.w + 80`). Use the next version (v2, v3, ...). Match the source shape's `w` / `h` so the aspect ratio is identical.
5. **Compose the edit prompt** — keep it focused on the *change*, not a full re-description:
   - The annotation markdown from step 1 (what to change and where).
   - An explicit instruction to keep everything else identical to the reference: subject's face, pose, framing, background, colors, text, and style.
   - The desired aspect ratio (same as the source shape).
6. **Generate the new image in EDIT mode with v1 as the reference**:
   ```bash
   python3 /path/to/linyuebanzi-image-gen/scripts/generate.py \
     --mode edit \
     --images "$(cat /tmp/v1-ref.txt)" \
     --aspect-ratio <w:h matching the holder> \
     --prompt "保持参考图的人物、姿势、构图、背景、文字与风格完全不变，只做以下修改：<annotation markdown>" \
     --name-tag cover-v2 \
     --output-dir canvas/pages/<canvas>/assets/
   ```
   The `--mode edit` + `--images` pair is what makes this image-to-image instead of a fresh draw. Never fall back to `--mode generation` for an annotation-driven revision.
7. **Fill the new holder** with `prompt_canvas_fill_ai_image_holder`. Pass `source_id` set to the v1 shape id so the edit lineage is recorded:
   ```json
   {
     "canvas_id": "<canvas id>",
     "shape_id": "<new v2 holder id>",
     "image_url": "/page-assets/<canvas>/<v2file>",
     "prompt": "<the edit prompt>",
     "source_id": "<v1 shape id>"
   }
   ```
8. **Open the canvas URL** so the user sees the new v2 next to v1. The canvas auto-syncs, so a manual refresh is usually unnecessary.
9. **Report back** with both shape ids (source v1 and new v2), confirmation that v1 was used as the reference image, the prompt, the image URL, and the canvas URL.

### C. Starting from scratch (no shapes yet)

If the canvas is empty and the user says "draw me a hero shot of a samurai cat":

1. `prompt_canvas_create_ai_image_holder` with a reasonable default size (e.g. 720×960 portrait, 720×720 square, 960×720 landscape).
2. Generate the image, move it into `canvas/pages/<canvas>/assets/`, and fill the holder (workflow A steps 3-5).
3. **Always open the canvas URL** and report it to the user, even if this is the very first image. The canvas auto-syncs, so the image should appear shortly without requiring a manual refresh.

### D. Inserting a standalone image

When there is no AI Image holder selected, or the user wants a revised image beside the original:

1. Use `prompt_canvas_insert_image` to create a new `ai-image` shape and fill it in one call:
   ```json
   {
     "canvas_id": "<canvas id>",
     "image_url": "/page-assets/<canvas>/<filename>.jpg",
     "x": 400,
     "y": 200,
     "w": 360,
     "h": 480,
     "label": "v2 revised"
   }
   ```
2. Open the canvas URL. The canvas will auto-sync the new image.

### E. Processing a canvas submit (when the user clicked "Submit to Codex")

The browser "Submit to Codex" button writes a pending request to `canvas/pages/<canvas>/_pending/submit-{ts}.md|json`. Codex must poll for it.

1. **Check for pending requests** with `prompt_canvas_get_pending_submits`.
   - Call this when the user says "我提交了" / "画布提交了" / "处理一下提交" or whenever you suspect the canvas has new annotations.
2. **Read the markdown** from the returned `md_path`.
3. **Show the user a concise summary** of the request and ask: "是否基于这些批注重生成 v2？"
4. **If confirmed**, proceed with workflow B (read annotations → create v2 holder → generate → fill → open canvas).
5. **Mark the submit as done** with `prompt_canvas_mark_submit_done` so it is not processed twice:
   ```json
   {
     "canvas_id": "<canvas id>",
     "ts": "20260621T071412"
   }
   ```

### F. Opening the canvas automatically

When the Browser plugin's `control-in-app-browser` skill is available, open the canvas for the user automatically:

1. Start the service with `./scripts/start-canvas.sh /path/to/user/codex-project`.
2. In a Node REPL session, bootstrap the Browser runtime and navigate:
   ```js
   const os = await import("node:os");
   const path = await import("node:path");
   const fs = await import("node:fs/promises");

   const homeDir = nodeRepl.homeDir ?? os.homedir();
   const codexHome = globalThis.process?.env?.CODEX_HOME ?? path.join(homeDir, ".codex");
   const browserRoot = path.join(codexHome, "plugins", "cache", "openai-bundled", "browser");
   const versions = (await fs.readdir(browserRoot)).sort();
   const browserClientPath = path.join(browserRoot, versions.at(-1), "scripts", "browser-client.mjs");

   const { setupBrowserRuntime } = await import(browserClientPath);
   await setupBrowserRuntime({ globals: globalThis });
   globalThis.browser = await agent.browsers.get("iab");

   await (await browser.capabilities.get("visibility")).set(true);
   let selectedTab = null;
   try { selectedTab = await browser.tabs.selected(); } catch (e) {
     if (!String(e?.message ?? e).includes("No active tab")) throw e;
   }
   globalThis.tab = selectedTab ?? await browser.tabs.new();
   const url = "http://127.0.0.1:52846/?canvas=<canvas_id>";
   if ((await tab.url()) !== url) await tab.goto(url);
   ```
   If browser control is unavailable, fall back to returning the local URL to the user.

## Coordinate system

- Origin is the top-left of the world (not the viewport). Coordinates are in "world pixels" — they don't change when the user pans or zooms.
- A reasonable default for an AI Image Holder is `w: 360, h: 480` (portrait 3:4) or `w: 720, h: 720` (square).
- The canvas is unbounded; place new shapes relative to existing ones. If the board is empty, start near `(200, 200)`.

## Image aspect ratios

Match the target shape's `w / h`. For a portrait shape that is 360×480 (3:4), generate a 3:4 image. For 720×960 (3:4), also 3:4. Don't generate a square image for a portrait frame — the canvas will either letterbox or stretch.

If the user explicitly asks for a different ratio, create a new `ai-image` holder with the new ratio and generate for that one.

## Understanding annotation markdown

`prompt_canvas_read_annotations` returns markdown like:

```markdown
目标图片: v1 (AI Image)
目标尺寸: 720×960
批注共 3 条:

1. [文字] 位于 底部中央 (x≈50%, y≈85%): "标题下移，留出边距"
2. [箭头] 从 (50%, 10%) 指向 (50%, 35%)，落点 中央: "这里太空，标题往下放"
3. [画笔圈] 覆盖约 12% 区域，位于 左下角: "碗底不要文字"
```

Include this block in the prompt to the image generator. Each line tells the model what to change and where.

## Common pitfalls

- **Generating without confirming the target.** Don't fire off an image generation call before you know the `ai-image` shape's id and size. If no shape is selected or the selection is not an `ai-image`, stop and ask.
- **Deleting the old version.** Keep the old `ai-image` shape on the canvas so the user can compare versions. Only delete if the user explicitly asks.
- **Ignoring annotations.** When regenerating, incorporate every arrow and text label the user drew. Use the `markdown` field from `prompt_canvas_read_annotations`.
- **Regenerating from text instead of editing the reference.** An annotation-driven v2 must use v1's actual pixels as a reference image via `--mode edit --images <v1 data URI>`. Do not re-draw from a text description of v1 — the face, pose, and composition will drift. See workflow B.
- **Wrong aspect ratio.** Always check `w / h` of the target holder and generate an image with the same ratio.
- **Forgetting the canvas id.** Most tools accept `canvas_id`. If omitted, the MCP server falls back to `PROMPT_CANVAS_CANVAS_ID` env var or `imported`. When in doubt, pass the canvas id explicitly.
- **Reporting success without the prompt and image URL.** Always include both in the final reply.
- **Forgetting to open the canvas after generating.** The user expects the generated image to appear in the Prompt Canvas browser tab. Always call `prompt_canvas_open` and provide the URL after filling an image holder.

## Quick reference (tool cheat sheet)

| Tool | Use when |
|------|----------|
| `prompt_canvas_open` | the user asks "open the canvas" or you need the URL |
| `prompt_canvas_health` | sanity check the server is up |
| `prompt_canvas_create_canvas` / `prompt_canvas_create_page` | starting a new thread/project |
| `prompt_canvas_list_canvases` / `prompt_canvas_list_pages` | finding existing canvases |
| `prompt_canvas_get_state` | you want the full snapshot (shapes + annotations) |
| `prompt_canvas_get_selection` | you need the user to pick an anchor/target |
| `prompt_canvas_create_ai_image_holder` | the canvas is empty or the user wants a new slot |
| `prompt_canvas_fill_ai_image_holder` | the main act: drop a generated image into a slot |
| `prompt_canvas_insert_image` | standalone image placement with no holder |
| `prompt_canvas_read_annotations` | the user scribbled feedback; you need structured instructions |
| `prompt_canvas_edit_image_from_annotations` | explicitly recording an edit intent before regenerating |
| `prompt_canvas_submit` | the user clicked "Submit to Codex" in the browser |
| `prompt_canvas_get_pending_submits` | polling for browser-submitted requests |
| `prompt_canvas_mark_submit_done` | after processing a pending request so it is not handled again |
| `prompt_canvas_delete_shape` | remove a shape; default to keeping everything |
| `prompt_canvas_reset` | start over |
