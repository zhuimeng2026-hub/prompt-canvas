// Prompt Canvas main entry (Vite + JSX build)
// tldraw-based infinite canvas with custom AI Image shape, red annotation tool,
// and a Codex console that drives the canvas via HTTP API + SSE.

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  Tldraw,
  BaseBoxShapeUtil,
  HTMLContainer,
  createShapeId,
} from 'tldraw';
import './styles.css';

// -------------------------------------------------------------
// Custom AI Image shape
// -------------------------------------------------------------
class AiImageShape extends BaseBoxShapeUtil {
  static type = 'ai-image';

  getDefaultProps() {
    return {
      w: 360,
      h: 480,
      version: 'v1',
      label: 'AI Image',
      imageUrl: '',
      imageMeta: null,
      prompt: '',
      sourceId: '',
      status: 'empty',
    };
  }

  component(shape) {
    const { w, h, version, label, imageUrl, status } = shape.props;
    const meta = shape.meta || {};
    const displayVersion = meta.version || version;
    const displayLabel = meta.label || label;
    const displayUrl = imageUrl || meta.image_url;

    return (
      <HTMLContainer style={{ width: w + 'px', height: h + 'px', pointerEvents: 'all', position: 'relative' }}>
        <div className={'cw-ai-image' + ((shape.meta && shape.meta._annoTarget) ? ' cw-anno-target' : '')} style={{ width: w + 'px', height: h + 'px', position: 'relative' }}>
          {displayUrl ? (
            <img src={displayUrl} alt={displayLabel}
                 style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                 draggable={false} />
          ) : (
            <div className="cw-ai-placeholder">
              <div className="cw-ai-placeholder-inner">
                <div className="cw-ai-spinner" />
                <div className="cw-ai-text">{status === 'loading' ? '生成中…' : 'AI Image Holder'}</div>
                <div className="cw-ai-sub">点击 Codex 控制台填充</div>
              </div>
            </div>
          )}
          <div className="cw-ai-version-tag">{displayVersion}</div>
          <div className="cw-ai-label-tag">{displayLabel}</div>
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }

  canEdit = () => false;
  canResize = () => true;
  canBind = () => true;
  // Provide outline so arrow binding snaps to the box edges.
  getOutline = (shape) => {
    const { w, h } = shape.props;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  };
}

const AI_SHAPE_UTIL = [AiImageShape];

// -------------------------------------------------------------
// Hover handle + arrow drag
// -------------------------------------------------------------
const CONNECTABLE_TYPES = new Set(['image', 'ai-image', 'geo', 'video']);

const plusItemBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: '#fff',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 13,
};
const plusItemSubmit = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: '#fff',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 13,
  borderTop: '1px solid #333',
  marginTop: 4,
  paddingTop: 8,
};
const plusIconBase = {
  width: 22, height: 22, borderRadius: 4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, color: '#0D1B2A', flexShrink: 0,
};

const iconBlue  = { ...plusIconBase, background: '#3b82f6' };
const iconAmber = { ...plusIconBase, background: '#FFB020' };
const iconGreen = { ...plusIconBase, background: '#22c55e' };

// Force re-render when the tldraw store changes (selection, hover, camera, etc.)
function useEditorReactive(editor) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.store.listen(() => {
      forceUpdate(n => (n + 1) & 0xffff);
    });
    return unsubscribe;
  }, [editor]);
}

function HoverHandle({ editor }) {
  useEditorReactive(editor);
  const [popover, setPopover] = useState(null);

  useEffect(() => {
    if (!popover) return;
    const close = (ev) => {
      const el = document.querySelector('.cw-plus-popover');
      if (el && el.contains(ev.target)) return;
      setPopover(null);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') setPopover(null); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [popover]);

  let hoveredId = null;
  try { hoveredId = editor?.getHoveredShape()?.id ?? null; } catch (e) {}

  let handleShape = null;
  let handleScreen = null;
  let handleSize = 18;
  if (hoveredId && editor) {
    const s = editor.getShape(hoveredId);
    if (s && CONNECTABLE_TYPES.has(s.type)) {
      const b = editor.getShapePageBounds(s);
      if (b) {
        handleShape = s;
        const sp = { x: b.x + b.w, y: b.y + b.h / 2 };
        handleScreen = editor.pageToScreen(sp);
        handleSize = Math.max(18, 18 / editor.getCamera().z);
      }
    }
  }

  if (!handleShape && !popover) return null;

  const onHandleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPopover({ shape: handleShape, x: e.clientX, y: e.clientY });
  };

  const choose = (action) => {
    const src = popover ? popover.shape : handleShape;
    setPopover(null);
    if (action === 'text') spawnTextChild(editor, src);
    else if (action === 'image') spawnImageChild(editor, src);
    else if (action === 'submit') submitFromShape(editor, src);
  };

  return (
    <div className="cw-hover-handle-wrap" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998 }}>
      {handleShape && handleScreen && (
        <div
          className="cw-hover-handle"
          data-handle-for={handleShape.id}
          style={{
            position: 'absolute',
            left: (handleScreen.x - handleSize / 2) + 'px',
            top: (handleScreen.y - handleSize / 2) + 'px',
            width: handleSize + 'px',
            height: handleSize + 'px',
            zIndex: 9999,
            pointerEvents: 'all',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#FFB020',
            color: '#0D1B2A',
            borderRadius: '50%',
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            fontSize: (handleSize * 0.7) + 'px',
            fontWeight: 700,
            lineHeight: 1,
            userSelect: 'none',
          }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={onHandleClick}
          title="点击弹出操作菜单 (创建子节点 / 提交 Codex)"
        >+</div>
      )}
      {popover && createPortal(
        <div
          className="cw-plus-popover"
          style={{
            position: 'fixed',
            left: Math.min(popover.x + 8, window.innerWidth - 220) + 'px',
            top: Math.min(popover.y + 8, window.innerHeight - 200) + 'px',
            zIndex: 9999,
            background: '#1a1a1a',
            color: '#fff',
            borderRadius: 10,
            padding: '6px 0',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            minWidth: 200,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 13,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            padding: '4px 14px 6px',
            fontSize: 10,
            color: '#999',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>引用该节点生成</div>
          <button className="cw-plus-item" onClick={() => choose('text')} style={plusItemBase}>
            <span style={iconBlue}>≡</span>
            <span>文本 (备注 / 需求)</span>
          </button>
          <button className="cw-plus-item" onClick={() => choose('image')} style={plusItemBase}>
            <span style={iconAmber}>▦</span>
            <span>图片 (新版本占位)</span>
          </button>
          <button className="cw-plus-item" onClick={() => choose('submit')} style={plusItemSubmit}>
            <span style={iconGreen}>↗</span>
            <span>提交给 Codex 生成下一版</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}


// -------------------------------------------------------------
// AI Image floating toolbar (download / alt / new version)
// -------------------------------------------------------------
async function downloadImage(url, filename) {
  const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
  try {
    const res = await fetch(fullUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'ai-image.png';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return { ok: true };
  } catch (e) {
    // fallback: open in new tab
    window.open(fullUrl, '_blank');
    return { ok: false, error: e.message };
  }
}

function AiImageToolbar({ editor }) {
  useEditorReactive(editor);
  const [showAlt, setShowAlt] = useState(false);

  let target = null;
  if (editor) {
    for (const id of editor.getSelectedShapeIds()) {
      const s = editor.getShape(id);
      if (s && s.type === 'ai-image') {
        const url = s.props.imageUrl || s.meta?.image_url;
        if (url) { target = s; break; }
      }
    }
    if (!target) {
      const h = editor.getHoveredShape();
      if (h && h.type === 'ai-image') {
        const url = h.props.imageUrl || h.meta?.image_url;
        if (url) target = h;
      }
    }
  }

  let bounds = null;
  if (target && editor) {
    const b = editor.getShapePageBounds(target);
    if (b) {
      const tl = editor.pageToScreen({ x: b.x, y: b.y });
      const tr = editor.pageToScreen({ x: b.x + b.w, y: b.y });
      bounds = { x: tl.x, y: tl.y, w: Math.max(1, tr.x - tl.x) };
    }
  }

  useEffect(() => {
    if (!target) setShowAlt(false);
  }, [target?.id]);

  if (!target || !bounds) return null;

  const imageUrl = target.props.imageUrl || target.meta?.image_url || '';
  const prompt = target.props.prompt || target.meta?.prompt || '';
  const version = target.props.version || target.meta?.version || '';
  const label = target.props.label || target.meta?.label || 'AI Image';

  const handleNewVersion = (e) => {
    e.preventDefault();
    e.stopPropagation();
    spawnImageChild(editor, target);
  };

  const handleDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const filename = `prompt-canvas-${version || 'image'}.png`;
    const res = await downloadImage(imageUrl, filename);
    toast(res.ok ? '已下载图片' : '下载失败，已在新标签页打开');
  };

  const handleAlt = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowAlt(v => !v);
  };

  return createPortal(
    <div
      className="cw-ai-image-toolbar"
      style={{
        position: 'fixed',
        left: bounds.x + bounds.w / 2,
        top: bounds.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 9990,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cw-ai-toolbar-inner">
        <button className="cw-ai-toolbar-btn" onClick={handleNewVersion} title="生成新版本 (v2/v3...)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <button className="cw-ai-toolbar-btn" onClick={handleDownload} title="下载图片">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button className="cw-ai-toolbar-btn cw-ai-toolbar-alt" onClick={handleAlt} title="查看 Prompt">
          ALT
        </button>
      </div>
      {showAlt && (
        <div className="cw-ai-alt-popover">
          <div className="cw-ai-alt-row"><strong>{label} · {version}</strong></div>
          <div className="cw-ai-alt-row cw-ai-alt-prompt">{prompt || '（无 prompt）'}</div>
          <div className="cw-ai-alt-row cw-ai-alt-url" title={imageUrl}>{imageUrl}</div>
        </div>
      )}
    </div>,
    document.body
  );
}


function spawnTextChild(editor, sourceShape) {
  const bounds = editor.getShapePageBounds(sourceShape);
  if (!bounds) return;
  const id = createShapeId();
  const noteW = 240;
  const x = bounds.x + bounds.w + 60;
  const y = bounds.y + bounds.h / 2 - 40;
  editor.createShape({
    id,
    type: 'text',
    x, y,
    props: {
      text: '',
      autoSize: true,
      w: noteW,
      color: 'black',
      font: 'draw',
      size: 'm',
      scale: 1,
    },
  });
  bindArrow(editor, sourceShape.id, id);
  editor.select(id);
  try { editor.setEditingShape(id); } catch (e) {}
  toast('已新建文本子节点,直接打字 → 提交给 Codex');
}

function spawnImageChild(editor, sourceShape) {
  const bounds = editor.getShapePageBounds(sourceShape);
  if (!bounds) return;
  const id = 'ai_' + Math.random().toString(36).slice(2, 10);
  const w = 320, h = 180;
  const x = bounds.x + bounds.w + 60;
  const y = bounds.y + bounds.h / 2 - h / 2;
  const nextV = (parseInt((sourceShape.props?.version || 'v0').replace('v',''), 10) || 0) + 1;
  const version = 'v' + nextV;
  editor.createShape({
    id: createShapeId(id),
    type: 'ai-image',
    x, y,
    meta: { role: 'ai-image', version, label: version + ' (empty)', image_url: '' },
    props: {
      w, h, version, label: version + ' (empty)',
      imageUrl: '', imageMeta: {}, prompt: '',
      sourceId: sourceShape.id, status: 'empty',
    },
  });
  bindArrow(editor, sourceShape.id, createShapeId(id));
  codexCommand('create_ai_image_holder', {
    shape_id: id, x, y, w, h, version, label: version + ' (empty)',
    prompt: '', source_id: sourceShape.id,
  });
  editor.select(createShapeId(id));
  toast('已新建 ' + version + ' 图片占位 → 等 Codex 填图');
}

function submitFromShape(editor, sourceShape) {
  editor.select(sourceShape.id);
  setTimeout(() => document.getElementById('cw-submit')?.click(), 50);
}

function bindArrow(editor, fromId, toId) {
  const from = editor.getShape(createShapeId(fromId)) || editor.getShape(fromId);
  const to = editor.getShape(createShapeId(toId)) || editor.getShape(toId);
  if (!from || !to) return;
  const fb = editor.getShapePageBounds(from);
  const tb = editor.getShapePageBounds(to);
  if (!fb || !tb) return;
  const arrowId = createShapeId();
  const start = { x: fb.x + fb.w, y: fb.y + fb.h / 2 };
  const end = { x: tb.x, y: tb.y + tb.h / 2 };
  editor.createShape({
    id: arrowId,
    type: 'arrow',
    x: start.x, y: start.y,
    props: { start, end },
  });
  editor.createBinding({ type: 'arrow', fromId: arrowId, toId: from.id, props: { terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false } });
  editor.createBinding({ type: 'arrow', fromId: arrowId, toId: to.id,   props: { terminal: 'end',   normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false } });
}

function startArrowDrag(editor, sourceShape, clientX, clientY) {
  try {
    const bounds = editor.getShapePageBounds(sourceShape);
    if (!bounds) return;
    const startPage = { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 };
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'arrow',
      x: startPage.x,
      y: startPage.y,
      props: {
        start: { x: startPage.x, y: startPage.y },
        end: { x: startPage.x, y: startPage.y },
      },
    });
    editor.createBinding({
      type: 'arrow',
      fromId: id,
      toId: sourceShape.id,
      props: {
        terminal: 'start',
        normalizedAnchor: { x: 1, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
    });
    editor.selectNone();
    let lastEnd = { x: startPage.x, y: startPage.y };

    function update(e) {
      const page = editor.screenToPage({ x: e.clientX, y: e.clientY });
      lastEnd = page;
      editor.updateShape({
        id,
        type: 'arrow',
        props: { end: { x: page.x, y: page.y } },
      });
    }

    function finish(e) {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('keydown', onKey);
      const page = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const hit = editor.getShapeAtPoint(page, { hitInside: true, margin: 0 });
      if (hit && hit.id !== sourceShape.id && CONNECTABLE_TYPES.has(hit.type)) {
        const tb = editor.getShapePageBounds(hit);
        editor.updateShape({
          id,
          type: 'arrow',
          props: { end: { x: page.x, y: page.y } },
        });
        if (tb) {
          editor.createBinding({
            type: 'arrow',
            fromId: id,
            toId: hit.id,
            props: {
              terminal: 'end',
              normalizedAnchor: {
                x: Math.max(0, Math.min(1, (page.x - tb.x) / Math.max(1, tb.w))),
                y: Math.max(0, Math.min(1, (page.y - tb.y) / Math.max(1, tb.h))),
              },
              isExact: true,
              isPrecise: true,
            },
          });
        }
      } else {
        editor.updateShape({
          id,
          type: 'arrow',
          props: { end: { x: lastEnd.x, y: lastEnd.y } },
        });
      }
      setTimeout(() => editor.selectNone(), 0);
      try { postSync(); } catch (err) {}
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        window.removeEventListener('pointermove', update);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('keydown', onKey);
        editor.deleteShape(id);
      }
    }

    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
    window.addEventListener('keydown', onKey);
  } catch (err) {
    console.error('[startArrowDrag] failed:', err);
    try { toast('连接失败: ' + (err.message || err)); } catch (e) {}
  }
}


// -------------------------------------------------------------
// State
// -------------------------------------------------------------
const SERVER_ORIGIN = window.location.origin;
const CANVAS_ID = new URLSearchParams(window.location.search).get('canvas') || 'imported';
const TLDRAW_DB_PREFIX = 'TLDRAW_DOCUMENT_v2';
const tldrawDbName = () => TLDRAW_DB_PREFIX + 'tldraw-' + CANVAS_ID;
const SHAPE_ID_ARRAY_FIELDS = ['selectedShapeIds', 'erasingShapeIds', 'lockedShapeIds', 'scribbleLockedShapeIds', 'bindingIds'];
const SHAPE_ID_SCALAR_FIELDS = ['hoveredShapeId', 'editingShapeId', 'croppingShapeId', 'focusedGroupId'];
const INSTANCE_PAGE_STATE_TYPE = 'instance_page_state';

function openPromptCanvasTldrawDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(tldrawDbName());
    req.onsuccess = () => resolve({ db: req.result, name: tldrawDbName() });
    req.onerror = () => resolve(null);
  });
}

function scanBadShapeIdsInDb(db) {
  return new Promise((resolve) => {
    const out = [];
    try {
      if (!db.objectStoreNames.contains('records')) return resolve(out);
      const tx = db.transaction('records', 'readonly');
      const store = tx.objectStore('records');
      const cur = store.openCursor();
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return resolve(out);
        const rec = c.value;
        if (rec && rec.type === INSTANCE_PAGE_STATE_TYPE) {
          for (const f of SHAPE_ID_ARRAY_FIELDS) {
            const v = rec[f];
            if (Array.isArray(v)) {
              for (const id of v) {
                if (typeof id === 'string' && id && !id.startsWith('shape:') && !id.startsWith('instance:')) {
                  out.push({ recId: rec.id, field: f, value: id });
                }
              }
            }
          }
          for (const f of SHAPE_ID_SCALAR_FIELDS) {
            const v = rec[f];
            if (typeof v === 'string' && v && !v.startsWith('shape:') && !v.startsWith('instance:')) {
              out.push({ recId: rec.id, field: f, value: v });
            }
          }
        }
        c.continue();
      };
      cur.onerror = () => resolve(out);
    } catch (e) { resolve([]); }
  });
}

function deletePromptCanvasTldrawDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const name = tldrawDbName();
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => { console.log('[prompt-canvas] deleted IndexedDB', name); resolve(); };
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

(async function cleanupBadTldrawState() {
  try {
    const opened = await openPromptCanvasTldrawDb();
    if (!opened) return;
    const { db, name } = opened;
    const bad = await scanBadShapeIdsInDb(db);
    db.close();
    if (bad.length) {
      console.warn('[prompt-canvas] found malformed shape ids in IndexedDB', name, bad);
      await deletePromptCanvasTldrawDb();
      const url = new URL(window.location.href);
      url.searchParams.set('_purged', '1');
      window.location.replace(url.toString());
    }
  } catch (e) { /* ignore */ }
})();

async function purgeLocalAndReload() {
  try { localStorage.removeItem('tldraw-' + CANVAS_ID); } catch (e) {}
  try { sessionStorage.removeItem('tldraw-' + CANVAS_ID); } catch (e) {}
  await deletePromptCanvasTldrawDb();
  const url = new URL(window.location.href);
  url.searchParams.set('_purged', '1');
  window.location.replace(url.toString());
}
window.__promptCanvasPurgeLocal = purgeLocalAndReload;

function canvasUrl(path) {
  return path + (path.includes('?') ? '&' : '?') + 'canvas=' + encodeURIComponent(CANVAS_ID);
}

fetch(canvasUrl('/api/canvas'), { method: 'GET' }).catch(() => {});
let editorRef = null;
let syncTimer = null;
let annotationTarget = null;
let annotationMode = false;
let annotationModeColor = '#ef4444';
let annotationModeText = '';

// -------------------------------------------------------------
// Clipboard helper
// -------------------------------------------------------------
async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (e) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  if (ok) return { ok: true };
  const accepted = window.confirm('剪贴板不可用。点击“确定”把文本显示在弹窗里手动复制。');
  if (accepted) {
    window.prompt('请手动复制以下内容:', text);
  }
  return { ok: false, error: 'clipboard unavailable' };
}

// -------------------------------------------------------------
// Annotation helpers
// -------------------------------------------------------------
const KIND_LABEL = { arrow: '箭头', draw: '画笔圈', text: '文字', geo: '几何框' };
const INTENT_MAP = {
  arrow: '箭头指向，要求修改此处',
  draw: '手绘圈出，要求修改此区域',
  text: '文字备注，说明修改需求',
  geo: '框选区域，要求修改此范围',
};

function round3(n) { return Math.round(n * 1000) / 1000; }

function quadrantDescription(relX, relY) {
  relX = Math.max(0, Math.min(1, relX));
  relY = Math.max(0, Math.min(1, relY));
  const h = relX < 0.33 ? '左' : relX < 0.67 ? '中' : '右';
  const v = relY < 0.33 ? '上' : relY < 0.67 ? '中' : '下';
  if (h === '中' && v === '中') return '中央';
  if (h === '中') return `${v}部中央`;
  if (v === '中') return `${h === '左' ? '左侧' : '右侧'}中部`;
  return `${v}${h}角`;
}

function getPlainText(shape) {
  const text = (shape.props && (shape.props.text || shape.props.richText)) || '';
  return typeof text === 'string' ? text : JSON.stringify(text);
}

function getAnnotationShapes(editor, targetId) {
  const bareId = targetId.replace(/^shape:/, '');
  return editor.getCurrentPageShapes().filter(s => {
    const meta = s.meta || {};
    return meta.role === 'annotation' && (meta.target === targetId || meta.target === bareId);
  });
}

function syncAnnotationsToImages(editor, imagePositions) {
  const images = editor.getCurrentPageShapes().filter(s => s.type === 'ai-image');
  const liveIds = new Set();
  for (const img of images) {
    liveIds.add(img.id);
    const prev = imagePositions.get(img.id);
    if (!prev) {
      imagePositions.set(img.id, { x: img.x, y: img.y });
      continue;
    }
    const dx = img.x - prev.x;
    const dy = img.y - prev.y;
    if (dx === 0 && dy === 0) continue;
    imagePositions.set(img.id, { x: img.x, y: img.y });
    const annotations = getAnnotationShapes(editor, img.id);
    for (const anno of annotations) {
      if (anno.type === 'arrow') continue;
      editor.updateShape({ id: anno.id, type: anno.type, x: anno.x + dx, y: anno.y + dy });
    }
  }
  for (const id of imagePositions.keys()) {
    if (!liveIds.has(id)) imagePositions.delete(id);
  }
}

function normalizeAnnotation(shape, target) {
  const tx = target.x, ty = target.y, tw = target.props.w, th = target.props.h;
  const kind = shape.type;
  const text = getPlainText(shape) || '';
  const color = (shape.meta && shape.meta.color) || '#ef4444';

  let x = shape.x, y = shape.y, w = 0, h = 0;
  let arrowStartRel = null, arrowEndRel = null;

  if (kind === 'arrow') {
    const start = (shape.props && shape.props.start) || { x, y };
    const end = (shape.props && shape.props.end) || { x, y };
    x = Math.min(start.x, end.x);
    y = Math.min(start.y, end.y);
    w = Math.abs(end.x - start.x);
    h = Math.abs(end.y - start.y);
    arrowStartRel = { x: round3((start.x - tx) / tw), y: round3((start.y - ty) / th) };
    arrowEndRel = { x: round3((end.x - tx) / tw), y: round3((end.y - ty) / th) };
  } else if (kind === 'draw') {
    const segments = (shape.props && shape.props.segments) || [];
    const pts = segments.flatMap(seg => seg.points || []);
    if (pts.length) {
      const xs = pts.map(p => p.x + shape.x);
      const ys = pts.map(p => p.y + shape.y);
      x = Math.min(...xs);
      y = Math.min(...ys);
      w = Math.max(...xs) - x;
      h = Math.max(...ys) - y;
    }
  } else {
    w = (shape.props && shape.props.w) || 0;
    h = (shape.props && shape.props.h) || 0;
  }

  const relBox = {
    x: round3((x - tx) / tw),
    y: round3((y - ty) / th),
    w: round3(w / tw),
    h: round3(h / th),
  };

  const relPx = arrowEndRel ? arrowEndRel.x : relBox.x + relBox.w / 2;
  const relPy = arrowEndRel ? arrowEndRel.y : relBox.y + relBox.h / 2;
  const region = quadrantDescription(relPx, relPy);
  const areaPercent = (kind === 'draw' || kind === 'geo') && w && h
    ? Math.round((w * h) / (tw * th) * 1000) / 10
    : null;

  const out = {
    id: shape.id,
    kind,
    text,
    color,
    absBox: { x, y, w, h },
    relBox,
    region,
    intent: INTENT_MAP[kind] || '修改批注',
  };
  if (arrowStartRel) {
    out.arrowStartRel = arrowStartRel;
    out.arrowEndRel = arrowEndRel;
  }
  if (areaPercent !== null) out.areaPercent = areaPercent;
  return out;
}

function buildAnnotationMarkdown(annotations, target) {
  if (!annotations.length) return '';
  const lines = [];
  lines.push(`目标图片: ${target.props.version} (${target.props.label || 'AI Image'})`);
  lines.push(`目标尺寸: ${Math.round(target.props.w)}×${Math.round(target.props.h)}`);
  lines.push(`批注共 ${annotations.length} 条:`);
  lines.push('');
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    const label = KIND_LABEL[a.kind] || a.kind;
    const text = a.text || '（无文字）';
    if (a.kind === 'arrow' && a.arrowStartRel) {
      const s = a.arrowStartRel, e = a.arrowEndRel;
      lines.push(`${i + 1}. [${label}] 从 (${Math.round(s.x * 100)}%, ${Math.round(s.y * 100)}%) 指向 (${Math.round(e.x * 100)}%, ${Math.round(e.y * 100)}%)，落点 ${a.region}: "${text}"`);
    } else if ((a.kind === 'draw' || a.kind === 'geo') && a.areaPercent) {
      lines.push(`${i + 1}. [${label}] 覆盖约 ${a.areaPercent}% 区域，位于 ${a.region}: "${text}"`);
    } else {
      lines.push(`${i + 1}. [${label}] 位于 ${a.region}: "${text}"`);
    }
  }
  lines.push('');
  return lines.join('\n');
}


// -------------------------------------------------------------
// Submit to Codex
// -------------------------------------------------------------
function buildSubmitPayload(editor) {
  try {
    const shapes = editor.getCurrentPageShapes();
    const aiImages = shapes.filter(s => s.type === 'ai-image');

    let target = null;
    const sel = editor.getSelectedShapeIds();
    for (const id of sel) {
      const s = editor.getShape(id);
      if (s && s.type === 'ai-image') { target = s; break; }
    }
    if (!target && aiImages.length) {
      target = aiImages.slice().sort((a, b) => {
        const va = parseInt((a.props.version || 'v0').replace('v', ''), 10) || 0;
        const vb = parseInt((b.props.version || 'v0').replace('v', ''), 10) || 0;
        return vb - va;
      })[0];
    }
    if (!target) return null;

    const arrows = shapes.filter(s => s.type === 'arrow');
    const targetId = target.id;

    let annotationShapes = [];
    let annotations = [];
    try {
      annotationShapes = getAnnotationShapes(editor, targetId);
      annotations = annotationShapes.map(s => normalizeAnnotation(s, target));
    } catch (e) {
      console.warn('[buildSubmitPayload] annotation processing failed:', e);
    }

    const arrowBindings = new Map();
    try {
      const all = editor.store.query.records('binding').get();
      for (const b of all) {
        if (b.type !== 'arrow') continue;
        let entry = arrowBindings.get(b.fromId);
        if (!entry) { entry = { start: null, end: null }; arrowBindings.set(b.fromId, entry); }
        entry[b.props.terminal] = b.toId;
      }
    } catch (e) { /* bindings not available */ }

    const referenceIds = new Set();
    const textIds = new Set();
    const arrowDescriptions = [];
    for (const arr of arrows) {
      const b = arrowBindings.get(arr.id) || {};
      const fromId = b.start;
      const toId = b.end;
      const label = (arr.props && (arr.props.text || arr.props.label)) || '';
      const touchesTarget = fromId === targetId || toId === targetId;
      if (!touchesTarget) continue;
      const otherId = fromId === targetId ? toId : fromId;
      if (!otherId) continue;
      const otherShape = editor.getShape(otherId);
      if (!otherShape) continue;
      if (otherShape.type === 'ai-image') continue;
      if (otherShape.type === 'text' || otherShape.type === 'geo') {
        textIds.add(otherShape.id);
        if (label) arrowDescriptions.push('→ ' + label);
      } else {
        referenceIds.add(otherShape.id);
      }
    }

    const annotationIds = new Set(annotationShapes.map(s => s.id));
    const allTexts = shapes.filter(s => s.type === 'text');
    const targetCx = target.x + target.props.w / 2;
    const targetCy = target.y + target.props.h / 2;
    for (const t of allTexts) {
      if (textIds.has(t.id) || annotationIds.has(t.id)) continue;
      const tcx = t.x + (t.props.w || 100) / 2;
      const tcy = t.y + (t.props.h || 30) / 2;
      const dist = Math.hypot(tcx - targetCx, tcy - targetCy);
      if (dist < 300) textIds.add(t.id);
    }

    const references = [];
    for (const rid of referenceIds) {
      const s = editor.getShape(rid);
      if (!s) continue;
      references.push({
        shape_id: s.id,
        type: s.type,
        image_url: s.props && s.props.url ? s.props.url : null,
        label: (s.props && (s.props.altText || s.props.text)) || '',
        x: Math.round(s.x),
        y: Math.round(s.y),
        w: Math.round((s.props && s.props.w) || 0),
        h: Math.round((s.props && s.props.h) || 0),
      });
    }

    const notes = [];
    for (const tid of textIds) {
      const s = editor.getShape(tid);
      if (!s) continue;
      const text = (s.props && (s.props.text || s.props.richText)) || '';
      const plain = typeof text === 'string' ? text : JSON.stringify(text);
      notes.push({
        shape_id: s.id,
        type: s.type,
        text: plain,
        x: Math.round(s.x),
        y: Math.round(s.y),
      });
    }
    arrowDescriptions.forEach(a => notes.push({ shape_id: 'arrow-label', type: 'arrow-label', text: a }));

    const usedVersions = aiImages
      .map(s => parseInt((s.props.version || 'v0').replace('v', ''), 10) || 0);
    const nextN = Math.max(0, ...usedVersions) + 1;
    const nextVersion = 'v' + nextN;

    const target_url = target.props.imageUrl || '';
    const target_natural = target.props.imageMeta && target.props.imageMeta.aspect_ratio;
    const target_natural_w = target.props.w;
    const target_natural_h = target.props.h;

    const targetJson = {
      shape_id: target.id,
      version: target.props.version,
      label: target.props.label,
      image_url: target_url,
      natural_w: target_natural_w,
      natural_h: target_natural_h,
      aspect_ratio: target_natural,
      prompt: target.props.prompt || '',
    };

    const md = [];
    md.push(`[Canvas 提交 · ${CANVAS_ID} · ${new Date().toISOString()}]`);
    md.push('');
    md.push(`目标版本: ${targetJson.version}  ${targetJson.label}`);
    if (target_url) md.push(`目标图: ${target_url}`);
    if (targetJson.aspect_ratio) md.push(`目标尺寸: ${target_natural_w}×${target_natural_h} (AR ${targetJson.aspect_ratio})`);
    if (targetJson.prompt) md.push(`目标 prompt 摘要: ${targetJson.prompt.slice(0, 200)}`);
    md.push('');
    if (references.length) {
      md.push(`引用图 (${references.length}):`);
      for (const r of references) {
        const url = r.image_url || '(无 URL)';
        const lbl = r.label ? ` · ${r.label}` : '';
        md.push(`- ${r.type}${lbl}: ${url}`);
      }
      md.push('');
    }
    if (annotations.length) {
      md.push(`视觉批注 (${annotations.length}):`);
      for (const a of annotations) {
        const label = KIND_LABEL[a.kind] || a.kind;
        const text = a.text || '（无文字）';
        if (a.kind === 'arrow' && a.arrowStartRel) {
          const s = a.arrowStartRel, e = a.arrowEndRel;
          md.push(`- [${label}] 从 (${Math.round(s.x * 100)}%, ${Math.round(s.y * 100)}%) 指向 (${Math.round(e.x * 100)}%, ${Math.round(e.y * 100)}%)，落点 ${a.region}: "${text}"`);
        } else if ((a.kind === 'draw' || a.kind === 'geo') && a.areaPercent) {
          md.push(`- [${label}] 覆盖约 ${a.areaPercent}% 区域，位于 ${a.region}: "${text}"`);
        } else {
          md.push(`- [${label}] 位于 ${a.region}: "${text}"`);
        }
      }
      md.push('');
    }
    if (notes.length) {
      md.push(`备注 (${notes.length}):`);
      for (const n of notes) {
        md.push(`- ${n.text}`);
      }
      md.push('');
    }
    md.push(`请生成 ${nextVersion}:`);
    md.push(`- 基于 ${targetJson.version}${references.length ? ' + 上述引用图' : ''}`);
    md.push(`- 保持 ${targetJson.version} 的构图与尺寸 (${target_natural_w}×${target_natural_h})`);
    if (notes.length) md.push(`- 应用上述备注中的修改方向`);
    md.push(`- 调用 linyuebanzi-image-gen,生成后 fill_ai_image_holder 到本画布`);

    return {
      canvas_id: CANVAS_ID,
      submitted_at: new Date().toISOString(),
      target: targetJson,
      references,
      annotations,
      notes,
      next_version: nextVersion,
      action: references.length ? 'edit_with_refs' : 'edit',
      md: md.join('\n'),
    };
  } catch (e) {
    console.error('[buildSubmitPayload] failed:', e);
    toast('构建提交失败: ' + (e.message || e));
    return null;
  }
}

// -------------------------------------------------------------
// Sync
// -------------------------------------------------------------
function serializeTldraw(editor) {
  const shapes = [];
  for (const shape of editor.getCurrentPageShapes()) {
    const meta = { ...(shape.meta || {}) };
    if (shape.type === 'ai-image') {
      meta.version = shape.props.version;
      meta.label = shape.props.label;
      meta.image_url = shape.props.imageUrl;
      meta.image_meta = shape.props.imageMeta;
      meta.prompt = shape.props.prompt;
      meta.source_id = shape.props.sourceId;
      meta.role = 'ai-image';
    }
    shapes.push({
      id: shape.id,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      parentId: shape.parentId,
      index: shape.index,
      opacity: shape.opacity,
      props: shape.props,
      meta,
    });
  }
  return { shapes, pageId: editor.getCurrentPageId() };
}

function frameShape(editor, shape, opts) {
  if (!editor || !shape) return;
  const pad = 0.18;
  const w = shape.props.w || 300;
  const h = shape.props.h || 400;
  editor.zoomToBounds(
    {
      x: shape.x - w * pad,
      y: shape.y - h * pad,
      w: w * (1 + 2 * pad),
      h: h * (1 + 2 * pad),
    },
    opts || { animation: { duration: 200 } }
  );
}

function frameAllShapes(editor) {
  const shapes = editor.getCurrentPageShapes();
  if (!shapes.length) return;
  if (shapes.length === 1) {
    frameShape(editor, shapes[0]);
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.props.w);
    maxY = Math.max(maxY, s.y + s.props.h);
  }
  const pad = 80;
  editor.zoomToBounds(
    { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
    { animation: { duration: 200 } }
  );
}

function postSync() {
  if (!editorRef) return;
  const snapshot = serializeTldraw(editorRef);
  fetch(canvasUrl('/api/sync'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tldraw: snapshot }),
  }).catch((e) => console.warn('sync failed', e));
}

function debouncedSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(postSync, 250);
}

function applyServerShape(editor, action, data) {
  if (action === 'create_ai_image_holder') {
    const s = data.shape;
    const id = createShapeId(s.id);
    if (!editor.getShape(id)) {
      editor.createShape({
        id,
        type: 'ai-image',
        x: s.x,
        y: s.y,
        meta: { role: 'ai-image', version: s.version, label: s.label, image_url: s.image_url || '' },
        props: {
          w: s.w,
          h: s.h,
          version: s.version,
          label: s.label,
          imageUrl: s.image_url || '',
          imageMeta: s.image_meta || {},
          prompt: s.prompt || '',
          sourceId: s.source_id || '',
          status: s.image_url ? 'ready' : 'empty',
        },
      });
    }
  } else if (action === 'fill_ai_image_holder') {
    const id = createShapeId(data.shape_id);
    const s = editor.getShape(id);
    if (s) {
      editor.updateShape({
        id,
        type: 'ai-image',
        props: {
          ...s.props,
          w: data.w ?? s.props.w,
          h: data.h ?? s.props.h,
          imageUrl: data.image_url,
          imageMeta: { ...(s.props.imageMeta || {}), ...(data.image_meta || {}) },
          version: data.version || s.props.version,
          prompt: data.prompt || s.props.prompt,
          status: 'ready',
        },
      });
      if (data.version && s.meta) s.meta.version = data.version;
      if (data.image_url && s.meta) s.meta.image_url = data.image_url;
    }
  } else if (action === 'delete_shape') {
    const id = createShapeId(data.shape_id);
    if (editor.getShape(id)) editor.deleteShape(id);
  } else if (action === 'reset') {
    const all = editor.getCurrentPageShapes().map(s => s.id);
    if (all.length) editor.deleteShapes(all);
  } else if (action === 'insert_image') {
    const s = data;
    const id = createShapeId(s.shape_id);
    if (!editor.getShape(id)) {
      editor.createShape({
        id,
        type: 'ai-image',
        x: s.x,
        y: s.y,
        meta: { role: 'ai-image', version: s.version, label: s.label, image_url: s.image_url || '' },
        props: {
          w: s.w,
          h: s.h,
          version: s.version,
          label: s.label,
          imageUrl: s.image_url || '',
          imageMeta: s.image_meta || {},
          prompt: s.prompt || '',
          sourceId: s.source_id || '',
          status: s.image_url ? 'ready' : 'empty',
        },
      });
    } else {
      applyServerShape(editor, 'fill_ai_image_holder', s);
    }
  }
}

function hydrateFromServer(editor, srv) {
  const serverShapes = Object.values(srv.shapes || {});
  for (const s of serverShapes) {
    const tid = createShapeId(s.id);
    if (!editor.getShape(tid)) {
      applyServerShape(editor, 'create_ai_image_holder', { shape: s });
    }
    if (s.image_url) {
      applyServerShape(editor, 'fill_ai_image_holder', {
        shape_id: s.id,
        image_url: s.image_url,
        image_meta: s.image_meta || {},
        version: s.version,
        prompt: s.prompt,
        w: s.w,
        h: s.h,
      });
    }
  }
  const serverIds = new Set(serverShapes.map(s => s.id));
  for (const sh of editor.getCurrentPageShapes()) {
    if (sh.type === 'ai-image' && sh.id.startsWith('shape:ai_')) {
      const logicalId = sh.id.replace('shape:', '');
      if (!serverIds.has(logicalId)) {
        editor.deleteShape(sh.id);
      }
    }
  }
}

function startSyncLoop() {
  let es = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let connected = false;

  const getCanvasId = () => new URLSearchParams(window.location.search).get('canvas') || 'imported';

  const connectSse = () => {
    if (es) { es.close(); es = null; }
    es = new EventSource(canvasUrl('/api/events'));
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'hello' || msg.event === 'read_annotations' || msg.event === 'image_generated') return;
        if (editorRef) applyServerShape(editorRef, msg.event, msg.data);
      } catch (e) {
        console.warn('sse parse', e);
      }
    };
    es.onerror = () => {
      setCodexStatus(false);
      connected = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSse, 3000);
    };
    es.onopen = () => {
      setCodexStatus(true);
      connected = true;
    };
  };

  const poll = async () => {
    if (!editorRef) return;
    try {
      const res = await fetch(canvasUrl(`/api/state?canvas=${getCanvasId()}`));
      const data = await res.json();
      hydrateFromServer(editorRef, data);
      setCodexStatus(true);
    } catch (e) {
      console.warn('poll failed', e);
      setCodexStatus(false);
    }
  };

  connectSse();
  pollTimer = setInterval(() => {
    if (!connected) poll();
  }, 5000);

  const onVisible = () => {
    if (!document.hidden && editorRef) {
      poll();
      if (!connected) connectSse();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // expose manual refresh
  window.__promptCanvasRefresh = poll;

  return () => {
    if (es) es.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollTimer) clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}


// -------------------------------------------------------------
// UI helpers
// -------------------------------------------------------------
function toast(text) {
  let t = document.getElementById('cw-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cw-toast';
    t.className = 'cw-toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function logLine(kind, body) {
  const log = document.getElementById('cw-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `cw-log-line ${kind}`;
  const ts = new Date().toLocaleTimeString('en-GB');
  line.innerHTML = `<span class="ts">${ts}</span><span class="body"></span>`;
  line.querySelector('.body').textContent = body;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setCodexStatus(online) {
  const el = document.getElementById('cw-codex-status');
  if (!el) return;
  el.classList.toggle('offline', !online);
  el.querySelector('.text').textContent = online ? '已连接 Codex' : 'Codex 离线';
}

function setLastAction(action, extra) {
  const el = document.getElementById('cw-codex-last-action');
  if (!el) return;
  const ts = new Date().toLocaleTimeString('en-GB');
  const txt = extra ? `${action}: ${extra}` : action;
  el.textContent = `[${ts}] ${txt}`;
}

function refreshFilesRail() {
  const list = document.getElementById('cw-rail-list');
  const count = document.getElementById('cw-rail-count');
  if (!list) return;
  fetch(canvasUrl('/api/state')).then((r) => r.json()).then((s) => {
    const shapes = Object.values(s.shapes || {}).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    list.innerHTML = '';
    if (count) count.textContent = String(shapes.length);
    if (shapes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cw-rail-item';
      empty.style.color = '#999';
      empty.style.cursor = 'default';
      empty.innerHTML = '<div class="cw-rail-thumb">空</div><div class="cw-rail-label">暂无 AI Image</div>';
      list.appendChild(empty);
      return;
    }
    for (const sh of shapes) {
      const item = document.createElement('div');
      item.className = 'cw-rail-item';
      item.dataset.id = sh.id;
      const thumb = document.createElement('div');
      thumb.className = 'cw-rail-thumb';
      if (sh.image_url) {
        thumb.style.backgroundImage = `url(${sh.image_url})`;
      } else {
        thumb.textContent = sh.version;
      }
      const label = document.createElement('div');
      label.className = 'cw-rail-label';
      label.textContent = `${sh.label} ${sh.version}`;
      item.appendChild(thumb);
      item.appendChild(label);
      item.addEventListener('click', () => {
        if (!editorRef) return;
        const id = createShapeId(sh.id);
        const shape = editorRef.getShape(id);
        if (shape) {
          editorRef.select(id);
          frameShape(editorRef, shape);
        }
      });
      list.appendChild(item);
    }
  });
}

function focusAiImage() {
  if (!editorRef) return null;
  const sel = editorRef.getSelectedShapeIds();
  for (const id of sel) {
    const s = editorRef.getShape(id);
    if (s && s.type === 'ai-image') return s;
  }
  for (const s of editorRef.getCurrentPageShapes()) {
    if (s.type === 'ai-image') return s;
  }
  return null;
}

function isAnnotationShape(shape) {
  return ['draw', 'arrow', 'text', 'geo'].includes(shape.type);
}

function attachAnnotationMeta(shape) {
  if (!annotationMode || !annotationTarget) return;
  if (shape.type === 'ai-image') return;
  const meta = { ...(shape.meta || {}), role: 'annotation', target: annotationTarget.id, color: annotationModeColor };
  if (annotationModeText) meta.text = annotationModeText;
  editorRef.updateShape({ id: shape.id, type: shape.type, meta });
}

async function codexCommand(action, args) {
  logLine('cmd', `codex.${action}(${JSON.stringify(args).slice(0, 80)})`);
  setLastAction(action, '...');
  try {
    const r = await fetch(canvasUrl('/api/commands'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args }),
    });
    const data = await r.json();
    if (!data.ok) {
      logLine('err', `${action}: ${data.error || 'failed'}`);
      setLastAction(action, `error: ${data.error || 'failed'}`);
    } else {
      logLine('ok', `${action} ✓`);
      const summary = data.shape_id || data.image_url || data.count !== undefined ? JSON.stringify({ shape_id: data.shape_id, image_url: data.image_url, count: data.count }).slice(0, 60) : 'ok';
      setLastAction(action, summary);
    }
    return data;
  } catch (e) {
    logLine('err', `${action}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// -------------------------------------------------------------
// Codex console actions
// -------------------------------------------------------------
function setupCodexConsole() {
  const annoToggle = document.getElementById('cw-anno-toggle');
  if (annoToggle) {
    annoToggle.addEventListener('click', () => {
      const target = focusAiImage();
      if (!target) { toast('请先选中一个 AI Image'); return; }
      annotationMode = !annotationMode;
      annotationTarget = annotationMode ? target : null;
      annoToggle.classList.toggle('active', annotationMode);
      const banner = document.getElementById('cw-anno-banner');
      if (banner) {
        banner.style.display = annotationMode ? 'flex' : 'none';
        banner.querySelector('.cw-anno-banner-target').textContent =
          `${annotationTarget.props.label} ${annotationTarget.props.version}`;
        const steps = banner.querySelector('.cw-anno-steps');
        if (steps) steps.style.display = annotationMode ? 'inline' : 'none';
      }
      try {
        if (editorRef) {
          if (annotationMode) {
            editorRef.select(annotationTarget.id);
            editorRef.updateShape({ id: annotationTarget.id, type: 'ai-image', meta: { ...(annotationTarget.meta||{}), _annoTarget: true } });
            toast('已选中 ' + annotationTarget.props.label + ' ' + annotationTarget.props.version + ' — 用底栏任意工具画标注');
          } else {
            editorRef.updateShape({ id: annotationTarget.id, type: 'ai-image', meta: { ...(annotationTarget.meta||{}), _annoTarget: false } });
          }
        }
      } catch (e) { console.warn('anno select', e); }
      logLine('sys', `批注模式 ${annotationMode ? '开启 → ' + annotationTarget.props.version : '关闭'}`);
    });
  }

  document.getElementById('cw-action-create')?.addEventListener('click', async () => {
    let x = 200, y = 200;
    try {
      const cam = editorRef.getCamera();
      if (cam && Number.isFinite(cam.zoom) && cam.zoom > 0) {
        x = (-cam.x + 300) / cam.zoom;
        y = (-cam.y + 200) / cam.zoom;
      }
    } catch (e) { /* fall back to fixed */ }
    if (!Number.isFinite(x)) x = 200;
    if (!Number.isFinite(y)) y = 200;
    const data = await codexCommand('create_ai_image_holder', { x, y, w: 360, h: 480, label: 'AI Image' });
    if (data.ok) {
      applyServerShape(editorRef, 'create_ai_image_holder', data);
      refreshFilesRail();
      setTimeout(() => {
        const last = editorRef.getCurrentPageShapes().slice(-1)[0];
        if (last) {
          editorRef.select(last.id);
          frameShape(editorRef, last);
        }
      }, 100);
      toast('已创建 AI Image Holder');
    }
  });

  document.getElementById('cw-action-fill-v1')?.addEventListener('click', async () => {
    const target = focusAiImage();
    if (!target) { toast('请先选中一个 AI Image'); return; }
    let prompt = (target.props.prompt || '').trim();
    if (!prompt) {
      prompt = window.prompt('该 AI Image 还没有 prompt。请输入要生成的内容:', 'A futuristic AI assistant cover');
      if (!prompt || !prompt.trim()) { toast('已取消'); return; }
    }
    logLine('sys', 'imagegen → v1...');
    const width = Math.round(target.props.w) || 720;
    const height = Math.round(target.props.h) || 960;
    const gen = await codexCommand('generate_image', {
      prompt: prompt.trim(),
      style: 'v1',
      width,
      height,
    });
    if (gen.ok) {
      const fill = await codexCommand('fill_ai_image_holder', {
        shape_id: target.id.replace('shape:', ''),
        image_url: SERVER_ORIGIN + gen.image_url,
        image_meta: gen.image_meta,
        prompt: prompt.trim(),
      });
      if (fill.ok) {
        applyServerShape(editorRef, 'fill_ai_image_holder', fill);
        refreshFilesRail();
        const filled = editorRef.getCurrentPageShapes().find(s => s.props.imageUrl);
        if (filled) {
          editorRef.select(filled.id);
          frameShape(editorRef, filled);
        }
        toast('已填充 v1');
      }
    }
  });

  document.getElementById('cw-action-read-anno')?.addEventListener('click', async () => {
    const target = focusAiImage();
    if (!target) { toast('请先选中一个 AI Image'); return; }
    const sid = target.id.replace('shape:', '');
    const data = await codexCommand('read_annotations', { shape_id: sid });
    if (data.ok) {
      const list = data.annotations;
      logLine('info', `读取到 ${list.length} 条批注:`);
      if (data.markdown) {
        logLine('info', '结构化指令:');
        data.markdown.split('\n').forEach(line => {
          if (line.trim()) logLine('info', '  ' + line);
        });
      } else {
        list.forEach((a, i) => {
          logLine('info', `  ${i + 1}. ${a.text || a.kind} (${a.color})`);
        });
      }
      toast(`读取到 ${list.length} 条批注`);
    }
  });

  document.getElementById('cw-action-gen-v2')?.addEventListener('click', async () => {
    const target = focusAiImage();
    if (!target) { toast('请先选中一个 AI Image (作为 v1)'); return; }
    const sid = target.id.replace('shape:', '');
    const rd = await codexCommand('read_annotations', { shape_id: sid });
    if (!rd.ok) return;
    const annTexts = rd.annotations.map((a) => a.text).filter(Boolean);
    logLine('info', `批注: ${annTexts.join(' | ') || '(无文本)'}`);

    const basePrompt = (target.props.prompt || '').trim();
    const editPrompt = annTexts.length
      ? `${basePrompt ? basePrompt + '。' : ''}根据以下批注重绘: ${annTexts.join('; ')}`
      : basePrompt || '基于上一版重新生成';

    const x = target.x + target.props.w + 80;
    const y = target.y;
    const v2holder = await codexCommand('create_ai_image_holder', {
      x, y, w: target.props.w || 360, h: target.props.h || 480,
      label: target.props.label || 'AI Image',
      meta: { source_id: sid, prompt: editPrompt },
    });
    if (!v2holder.ok) return;
    applyServerShape(editorRef, 'create_ai_image_holder', v2holder);
    const nextVersion = v2holder.data.shape.version;

    const gen = await codexCommand('generate_image', {
      prompt: editPrompt,
      style: nextVersion,
      width: Math.round(target.props.w) || 720,
      height: Math.round(target.props.h) || 960,
    });
    if (gen.ok) {
      const fill = await codexCommand('fill_ai_image_holder', {
        shape_id: v2holder.data.shape.id,
        image_url: SERVER_ORIGIN + gen.image_url,
        image_meta: gen.image_meta,
      });
      if (fill.ok) {
        applyServerShape(editorRef, 'fill_ai_image_holder', fill);
        refreshFilesRail();
        const newShape = editorRef.getCurrentPageShapes().find(s => s.props.version === nextVersion);
        if (newShape) {
          editorRef.select(newShape.id);
          frameShape(editorRef, newShape);
        }
        toast(`已生成 ${nextVersion}`);
      }
    }
  });

  document.getElementById('cw-action-reset')?.addEventListener('click', async () => {
    if (!confirm('重置画布？所有 AI Image 和批注将被清除。')) return;
    await codexCommand('reset', {});
    refreshFilesRail();
    toast('画布已重置');
  });
}


// -------------------------------------------------------------
// Tldraw mount
// -------------------------------------------------------------
function TldrawApp() {
  const [mountedEditor, setMountedEditor] = useState(null);

  const onMount = (editor) => {
    editorRef = editor;
    window.editorRef = editor;
    window.__shapes = () => editor.getCurrentPageShapes().map(s => ({id: s.id, type: s.type, x: s.x, y: s.y, w: s.props.w, h: s.props.h}));
    window.__cam = () => editor.getCamera();
    editor.user.updateUserPreferences({ colorScheme: 'light' });
    setMountedEditor(editor);

    const seenIds = new Set(editor.getCurrentPageShapes().map(s => s.id));
    const imagePositions = new Map();
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type === 'ai-image') imagePositions.set(s.id, { x: s.x, y: s.y });
    }
    editor.store.listen(() => {
      const current = editor.getCurrentPageShapes();
      for (const shape of current) {
        if (!seenIds.has(shape.id)) {
          seenIds.add(shape.id);
          if (annotationMode && annotationTarget && isAnnotationShape(shape)) {
            queueMicrotask(() => attachAnnotationMeta(shape));
          }
        }
      }
      syncAnnotationsToImages(editor, imagePositions);
      debouncedSync();
      refreshFilesRail();
    }, { scope: 'document' });

    fetch(canvasUrl('/api/state')).then((r) => r.json()).then((srv) => {
      hydrateFromServer(editor, srv);
    }).catch((e) => console.warn('hydrate failed', e));

    startSyncLoop();

    setTimeout(() => {
      postSync();
      refreshFilesRail();
      try { frameAllShapes(editor); } catch (e) { /* no shapes yet */ }
    }, 300);
    logLine('sys', '画布就绪');
  };

  return (
    <>
      <Tldraw
        shapeUtils={AI_SHAPE_UTIL}
        onMount={onMount}
        hideUi={false}
        inferDarkMode={false}
        cameraOptions={{ panSpeed: 0.5, zoomSpeed: 0.5, isLocked: false, wheelBehavior: 'pan', inertia: 0.5 }}
        persistenceKey={'tldraw-' + CANVAS_ID}
      />
      {mountedEditor && <HoverHandle editor={mountedEditor} />}
      {mountedEditor && <AiImageToolbar editor={mountedEditor} />}
    </>
  );
}

// -------------------------------------------------------------
// Mount shell
// -------------------------------------------------------------
function mount() {
  const canvas = document.getElementById('cw-canvas');
  const rail = document.getElementById('cw-rail');
  const banner = document.getElementById('cw-anno-banner');
  const topbar = document.getElementById('cw-topbar');
  const codex = document.getElementById('cw-codex');

  rail.innerHTML = `
    <div class="cw-rail-header">
      <span class="cw-rail-title">FILES</span>
      <span class="cw-rail-status-count" id="cw-rail-count">0</span>
    </div>
    <div class="cw-rail-actions">
      <select class="cw-select" id="cw-rail-select">
        <option>全部</option>
        <option>有图</option>
        <option>空占位</option>
      </select>
      <button class="cw-icon-btn" id="cw-rail-add" title="新增">+</button>
    </div>
    <div class="cw-rail-list" id="cw-rail-list"></div>
    <div class="cw-rail-status">
      <span class="dot"></span><span id="cw-rail-server">Server OK</span>
    </div>
  `;

  banner.className = 'cw-anno-banner';
  banner.style.display = 'none';
  banner.innerHTML = `
    <span class="swatch"></span>
    <span>批注模式 → 目标:</span>
    <strong class="cw-anno-banner-target">-</strong>
    <span class="cw-anno-steps" style="color:#666;font-size:11px;margin-left:8px">
      1. 用 <b>画笔</b>画 / <b>箭头</b>标 / <b>文字</b>写  →  2. 点右侧 <b>读取代注</b>
    </span>
  `;

  topbar.className = 'cw-topbar';
  topbar.innerHTML = `
    <button class="cw-pill" id="cw-anno-toggle" title="切换批注模式 (对选中的 AI Image 上色)">
      <span class="dot" style="background:#ef4444"></span> 批注
    </button>
    <button class="cw-pill" id="cw-fit" title="把所有 shapes 适配进视图">适配</button>
    <button class="cw-pill" id="cw-refresh" title="立即从服务器同步最新画布状态">刷新</button>
    <button class="cw-pill amber" id="cw-anno-note" title="在选中 AI Image 下方新建一个可编辑 text shape,直接打字写备注">
      <span class="dot" style="background:#1a1a1a"></span> 备注
    </button>
    <button class="cw-pill" id="cw-copy-anno-md" title="复制当前选中 AI Image 的结构化批注指令到剪贴板">
      <span class="dot" style="background:#22c55e"></span> 复制批注指令
    </button>
    <button class="cw-pill" id="cw-submit" title="把画布上的目标图 + 引用图 + 备注打包,提交给 Codex">
      <span class="dot" style="background:#FFB020"></span> 提交给 Codex
    </button>
    <button class="cw-pill" id="cw-toggle-files" title="展开 / 收起左侧 FILES 列表">
      <span class="dot" style="background:#6b6b6b"></span> FILES
    </button>
    <button class="cw-pill" id="cw-purge-local" title="清掉当前画布的 tldraw 本地缓存(任何坏状态一键修复)→ 然后自动从服务器重新加载">
      <span class="dot" style="background:#ef4444"></span> 清本地
    </button>
    <button class="cw-pill" id="cw-collapse-codex" title="折叠 / 展开右侧 Codex 控制台">
      <span class="dot" style="background:#1a73e8"></span> 折叠 Codex
    </button>
  `;

  codex.className = 'cw-codex';
  codex.innerHTML = `
    <div class="cw-codex-head">
      <div class="cw-title">
        <span>Codex 控制台</span>
        <span class="cw-badge">MCP</span>
      </div>
    </div>
    <div class="cw-codex-actions">
      <button class="cw-codex-action" id="cw-action-create">
        <span class="ico">＋</span>
        <div>
          <div class="label">创建 AI Image Holder</div>
          <div class="desc">新增一个空 shape，等 Codex 填图</div>
        </div>
      </button>
      <button class="cw-codex-action" id="cw-action-fill-v1">
        <span class="ico">▷</span>
        <div>
          <div class="label">Fill AI Image Holder → v1</div>
          <div class="desc">调用 imagegen，生成第一版广告</div>
        </div>
      </button>
      <button class="cw-codex-action" id="cw-action-read-anno">
        <span class="ico">⌕</span>
        <div>
          <div class="label">读取批注</div>
          <div class="desc">从画布读取所有红色批注文本</div>
        </div>
      </button>
      <button class="cw-codex-action" id="cw-action-gen-v2">
        <span class="ico">⟳</span>
        <div>
          <div class="label">Edit Image From Annotations → 下一版</div>
          <div class="desc">基于批注重生成下一个版本</div>
        </div>
      </button>
      <button class="cw-codex-action" id="cw-action-reset">
        <span class="ico" style="background:#fce8e6;color:#c5221f">⟲</span>
        <div>
          <div class="label">重置画布</div>
          <div class="desc">清空所有 shapes 和批注</div>
        </div>
      </button>
    </div>
    <div class="cw-codex-log" id="cw-log"></div>
    <div class="cw-codex-foot">
      <div class="status" id="cw-codex-status">
        <span class="dot"></span>
        <span class="text">已连接 Codex</span>
      </div>
      <div id="cw-codex-last-action">POST /api/commands</div>
    </div>
  `;

  const root = createRoot(canvas);
  root.render(<TldrawApp />);

  document.getElementById('cw-rail-add')?.addEventListener('click', () => {
    document.getElementById('cw-action-create')?.click();
  });
  document.getElementById('cw-fit')?.addEventListener('click', () => {
    if (editorRef) frameAllShapes(editorRef);
  });

  document.getElementById('cw-refresh')?.addEventListener('click', () => {
    if (window.__promptCanvasRefresh) {
      window.__promptCanvasRefresh();
      toast('已同步画布状态');
    } else {
      toast('画布还没准备好');
    }
  });

  document.getElementById('cw-anno-note')?.addEventListener('click', () => {
    if (!editorRef) { toast('画布还没准备好'); return; }
    const editor = editorRef;
    const shapes = editor.getCurrentPageShapes();
    const aiImages = shapes.filter(s => s.type === 'ai-image');
    if (!aiImages.length) { toast('画布里还没有 AI Image'); return; }
    let target = null;
    const sel = editor.getSelectedShapeIds();
    for (const id of sel) {
      const s = editor.getShape(id);
      if (s && s.type === 'ai-image') { target = s; break; }
    }
    if (!target) {
      target = aiImages.slice().sort((a, b) => {
        const va = parseInt((a.props.version || 'v0').replace('v', ''), 10) || 0;
        const vb = parseInt((b.props.version || 'v0').replace('v', ''), 10) || 0;
        return vb - va;
      })[0];
    }
    const id = createShapeId();
    const noteW = 220;
    const noteX = target.x + (target.props.w / 2) - (noteW / 2);
    const noteY = target.y + target.props.h + 24;
    editor.createShape({
      id,
      type: 'text',
      x: noteX,
      y: noteY,
      props: {
        text: '',
        autoSize: true,
        w: noteW,
        color: 'black',
        font: 'draw',
        size: 'm',
        scale: 1,
      },
    });
    editor.select(id);
    try { editor.setEditingShape(id); } catch (e) {}
    toast('已新建备注 text shape,直接打字即可 · 提交时自动收录');
  });

  document.getElementById('cw-copy-anno-md')?.addEventListener('click', async () => {
    if (!editorRef) { toast('画布还没准备好'); return; }
    const target = focusAiImage();
    if (!target) { toast('请先选中一个 AI Image'); return; }
    const annotationShapes = getAnnotationShapes(editorRef, target.id);
    if (!annotationShapes.length) { toast('当前目标没有批注'); return; }
    const annotations = annotationShapes.map(s => normalizeAnnotation(s, target));
    const markdown = buildAnnotationMarkdown(annotations, target);
    const res = await copyText(markdown);
    if (res.ok) {
      logLine('info', '已复制批注指令:\n' + markdown.split('\n').map(l => '  ' + l).join('\n'));
      toast('已复制批注指令到剪贴板');
    } else {
      toast('复制失败，请手动复制弹窗中的内容');
    }
  });

  document.getElementById('cw-collapse-codex')?.addEventListener('click', () => {
    const codex = document.getElementById('cw-codex');
    if (!codex) return;
    const collapsed = codex.classList.toggle('collapsed');
    const btn = document.getElementById('cw-collapse-codex');
    if (btn) {
      btn.innerHTML = collapsed
        ? '<span class="dot" style="background:#1a73e8"></span> 展开 Codex'
        : '<span class="dot" style="background:#1a73e8"></span> 折叠 Codex';
    }
    setTimeout(() => { try { postSync(); } catch (e) {} }, 50);
  });

  const railElInit = document.getElementById('cw-rail');
  if (railElInit && !railElInit.classList.contains('collapsed') && !railElInit.dataset.userSet) {
    railElInit.classList.add('collapsed');
  }
  document.getElementById('cw-toggle-files')?.addEventListener('click', () => {
    const rail = document.getElementById('cw-rail');
    if (!rail) return;
    const collapsed = rail.classList.toggle('collapsed');
    rail.dataset.userSet = '1';
    const btn = document.getElementById('cw-toggle-files');
    if (btn) {
      btn.innerHTML = collapsed
        ? '<span class="dot" style="background:#6b6b6b"></span> FILES'
        : '<span class="dot" style="background:#6b6b6b"></span> 收起 FILES';
    }
  });

  document.getElementById('cw-purge-local')?.addEventListener('click', () => {
    if (!confirm('清掉当前画布的本地 tldraw 缓存并重新加载?\n(画布上的 AI Image / 箭头会从服务器恢复;手动画的批注 / 自由排版会丢失)')) return;
    purgeLocalAndReload();
  });

  document.getElementById('cw-submit')?.addEventListener('click', async () => {
    try {
      if (!editorRef) { toast('画布还没准备好'); return; }
      const payload = buildSubmitPayload(editorRef);
      if (!payload) {
        toast('画布里没有 AI Image,先把图拖进来');
        return;
      }
      if (!payload.notes || payload.notes.length === 0) {
        const hint = payload.references && payload.references.length
          ? 'v' + payload.target.version.replace('v','') + ' 用参考图重新画图...'
          : 'v' + (parseInt((payload.next_version || 'v2').replace('v',''), 10)) + ' ...';
        const note = window.prompt('画布里没有 text 备注。直接打字加一行 (留空则不写备注):', hint);
        if (note && note.trim()) {
          payload.notes = [{ text: note.trim(), source: 'prompt' }];
          const lines = payload.md.split('\n');
          const insertAt = lines.findIndex(l => l.startsWith('请生成'));
          const block = '\n备注 (1):\n- ' + note.trim() + '\n';
          if (insertAt >= 0) lines.splice(insertAt, 0, block);
          else lines.push(block);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('- 应用上述备注中的修改方向')) { lines.splice(i, 1); break; }
          }
          payload.md = lines.join('\n');
        }
      }
      const md = payload.md;
      const copyRes = await copyText(md);
      const copied = copyRes.ok;
      const r = await fetch(canvasUrl('/api/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.ok) {
        logLine('sys', '已提交给 Codex: ' + data.md_path);
        toast(copied ? '已复制+已提交' : '已提交 (复制失败,请手动复制)');
      } else {
        toast('提交失败: ' + (data.error || 'unknown'));
      }
    } catch (e) {
      console.error('[cw-submit]', e);
      toast('提交出错: ' + (e.message || e));
    }
  });

  setupCodexConsole();
  refreshFilesRail();
  setInterval(refreshFilesRail, 5000);
}

mount();
