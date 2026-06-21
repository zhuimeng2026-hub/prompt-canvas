# Prompt Canvas

一个本地优先的无限画布，让 Codex 通过可视化的方式迭代 AI 图像生成。核心思路是：**在图片上直接画批注（箭头、涂鸦、文字）来驱动修改**，而不是每次都用自然语言描述像素级变化。

## 业务逻辑

- **Skills** (`skills/`)：拆分后的 Codex skill（打开画布、生图、修图/批注）
- **MCP server** (`mcp-server/prompt_canvas_mcp.py`)：把画布能力暴露成 Codex 可调用的工具
- **本地 Web 程序** (`canvas/`)：基于 tldraw 的画布 UI，内嵌在 Codex 浏览器中使用
- **本地服务** (`server.py`)：Flask 后端，持久化到 SQLite (`.cowart.db`)
- **Codex**：理解用户需求、调用 `linyuebanzi-image-gen` 等 skill 生图、回填到画布

## 文件结构

```
.
├── .codex-plugin/
│   └── plugin.json              # Codex 插件元数据
├── .mcp.json                    # MCP 服务器注册
├── package.json                 # npm / Vite 构建配置
├── vite.config.js               # Vite 配置
├── server.py                    # Flask 后端：REST API + SSE + SQLite 持久化
├── imagegen.py                  # 本地 mock 生图（无真实 API 时 fallback 用）
├── canvas/                      # 前端画布源码（tldraw + 自定义 AI Image shape）
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx             # React 入口
│   │   └── styles.css           # 自定义样式
│   ├── dist/                    # Vite 构建产物
│   └── tldraw.css
├── scripts/
│   ├── start-canvas.sh          # 启动画布服务
│   └── start-mcp.sh             # 启动 MCP 服务器
├── mcp-server/
│   └── prompt_canvas_mcp.py     # MCP server，供 Codex 调用
├── skills/
│   └── prompt-canvas/           # Codex skill（打开画布、生图、批注修图）
├── generated/                   # 生成的图片和 pending submit 文件（legacy）
├── canvas/pages/                # 插件模式下的项目级页面数据
└── .cowart.db                   # SQLite 数据库（运行时生成，保留旧名以兼容历史数据）
```

## 安装与启动

### 作为 Codex 插件使用（推荐）

```bash
# 安装依赖并构建前端
npm install
npm run build

# 启动画布服务（绑定到当前 Codex 项目目录）
./scripts/start-canvas.sh /path/to/your/codex-project
```

服务启动后会自动打开：`http://127.0.0.1:47321/`

画布数据会写入项目目录：
- 页面快照：`/path/to/your/codex-project/canvas/pages/<page>/prompt-canvas.json`
- 页面资源：`/path/to/your/codex-project/canvas/pages/<page>/assets/`

### 纯本地开发

```bash
# 1. 启动 Flask 后端
python3 server.py

# 2. 开发模式启动前端（Vite dev server 会代理 /api 到 Flask）
npm run dev

# 3. 在浏览器打开
open http://127.0.0.1:5173/canvas/
```

### 注册 MCP server（一次性）

```bash
codex mcp add prompt-canvas -- python3 $(pwd)/mcp-server/prompt_canvas_mcp.py
```

插件模式下，`.mcp.json` 已经声明了 MCP 服务器，Codex 会自动加载。

## 核心交互

1. 在 Codex 中让 Prompt Canvas 创建一个 AI Image Holder
2. Codex 调用 `linyuebanzi-image-gen` 生成图片并填充到画布
3. 用户在图片上画批注（箭头、圈、文字）表达修改意图
4. 用户点击"提交给 Codex"或"复制批注指令"
5. Codex 读取结构化批注 markdown，生成新版本图片
6. 新版本出现在画布上，可继续迭代

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PROMPT_CANVAS_PROJECT_DIR` | 当前 Codex 项目目录 | 当前工作目录 |
| `PROMPT_CANVAS_CANVAS_DIR` | 画布数据存放目录 | `$PROMPT_CANVAS_PROJECT_DIR/canvas` |
| `PROMPT_CANVAS_PORT` | Flask 服务端口 | `47321` |
| `PROMPT_CANVAS_HOST` | Flask 监听地址 | `127.0.0.1` |

## 注意

- `.cowart.db`、`generated/`、`.cowart_state.json`、`canvas/pages/`、`canvas/dist/`、`node_modules/` 等是运行时数据，已被 `.gitignore` 忽略
- 真实生图依赖 Codex 调用外部 skill（如 `linyuebanzi-image-gen`），本地 `imagegen.py` 仅作为 mock fallback
- 旧数据仍保留在 SQLite + `generated/`，新数据会双写到项目级 `canvas/pages/`
