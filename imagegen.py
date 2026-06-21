"""
imagegen.py - server-side image generation that simulates the real imagegen tool.

In production this would call an actual image generation API. For this demo it
uses PIL to produce stylized "ad" images that match the prompt + style hints
from the calling code (v1 = original flaws, v2 = corrected per annotations).
"""

from __future__ import annotations

import io
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"

# Map a style to a base image. v1 uses the flawed one, v2 uses the corrected one.
STYLE_BASES = {
    "v1": "ramen-v1.jpg",
    "v2": "ramen-v2.jpg",
    "default": "ramen-bowl.jpg",
}

# Detect Chinese chars for font fallback
CN_RE = re.compile(r"[\u4e00-\u9fff]")

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

_title_font = None
_sub_font = None


def _load_fonts():
    global _title_font, _sub_font
    if _title_font is not None:
        return _title_font, _sub_font
    base = None
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            base = p
            break
    if base is None:
        _title_font = ImageFont.load_default()
        _sub_font = ImageFont.load_default()
    else:
        _title_font = ImageFont.truetype(base, size=72)
        _sub_font = ImageFont.truetype(base, size=28)
    return _title_font, _sub_font


def _has_cn(s: str) -> bool:
    return bool(CN_RE.search(s))


def _fit_text(draw, text, max_w, font):
    """If text is too wide, drop the font size until it fits."""
    if not text:
        return text, font
    size = font.size
    f = font
    while draw.textlength(text, font=f) > max_w and size > 12:
        size -= 2
        # need same family: re-load with new size
        try:
            f = ImageFont.truetype(font.path, size=size)
        except Exception:
            break
    return text, f


def _draw_centered(draw, text, font, box, fill, y_offset=0, stroke=0, stroke_fill=None):
    x0, y0, x1, y1 = box
    tw = draw.textlength(text, font=font)
    th = font.size
    tx = x0 + (x1 - x0 - tw) / 2
    ty = y0 + (y1 - y0 - th) / 2 + y_offset
    if stroke > 0:
        draw.text((tx, ty), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill or fill)
    else:
        draw.text((tx, ty), text, font=font, fill=fill)


def _draw_title_v1(img, title, subtitle):
    """v1 style: title pushed to top edge, no margin (the 'flawed' look)."""
    draw = ImageDraw.Draw(img)
    title_font, sub_font = _load_fonts()
    W, H = img.size
    # Gold title pinned to top - the 'title too close to edge' flaw
    title = title or "\u62c9\u9762\u4e00\u756a"
    subtitle = subtitle or "\u6d41\u6c64\u73b0\u70e4 \u00b7 \u4e00\u53e3\u5165\u9b42"
    if not _has_cn(title):
        title_font = ImageFont.truetype("/System/Library/Fonts/Georgia.ttf", 80) if os.path.exists("/System/Library/Fonts/Georgia.ttf") else title_font
    draw.text((W * 0.04, 12), title, font=title_font, fill=(212, 175, 55))  # gold, touching top edge
    # subtitle in white at lower band
    draw.text((W * 0.06, H - 90), subtitle, font=sub_font, fill=(245, 245, 240))
    # bowl-bottom text (flaw)
    draw.text((W * 0.05, H - 36), "\u62c9\u9762\u4e00\u756a", font=sub_font, fill=(200, 180, 130))


def _draw_title_v2(img, title, subtitle):
    """v2 style: title centered with margin, no bottom text, chopsticks present in base."""
    draw = ImageDraw.Draw(img)
    title_font, sub_font = _load_fonts()
    W, H = img.size
    title = title or "\u62c9\u9762\u4e00\u756a"
    subtitle = subtitle or "\u6d53\u6c64\u73b0\u70e4 \u00b7 \u4e00\u53e3\u5165\u9b42"
    # 12% top margin
    margin_x = int(W * 0.10)
    box_top = int(H * 0.10)
    box_bot = int(H * 0.28)
    # Constrain to fit
    title, tfont = _fit_text(draw, title, W - 2 * margin_x, title_font)
    _draw_centered(draw, title, tfont, (margin_x, box_top, W - margin_x, box_bot), fill=(212, 175, 55))
    # Subtitle below the bowl
    sub, sfont = _fit_text(draw, subtitle, W - 2 * margin_x, sub_font)
    _draw_centered(draw, sub, sfont, (margin_x, int(H * 0.85), W - margin_x, H - 20), fill=(245, 245, 240))
    # No bottom text this time (flaw fixed)


def _draw_title_custom(img, title, subtitle, prompt_hints):
    """Custom style: respect prompt_hints dict with overrides."""
    draw = ImageDraw.Draw(img)
    title_font, sub_font = _load_fonts()
    W, H = img.size
    if not title:
        title = "\u62c9\u9762\u4e00\u756a"
    if not subtitle:
        subtitle = "\u6d41\u6c64\u73b0\u70e4 \u00b7 \u4e00\u53e3\u5165\u9b42"
    margin = float(prompt_hints.get("title_margin", 0.10))
    title_color = prompt_hints.get("title_color", (212, 175, 55))
    title_y = int(H * margin)
    title_box_bot = title_y + int(title_font.size * 1.4)
    margin_x = int(W * 0.08)
    title, tfont = _fit_text(draw, title, W - 2 * margin_x, title_font)
    _draw_centered(draw, title, tfont, (margin_x, title_y, W - margin_x, title_box_bot), fill=title_color)
    sub, sfont = _fit_text(draw, subtitle, W - 2 * margin_x, sub_font)
    _draw_centered(draw, sub, sfont, (margin_x, int(H * 0.85), W - margin_x, H - 20), fill=(245, 245, 240))


def generate(prompt: str, style: str = "v1", width: int = 720, height: int = 960, refs=None):
    """Produce a JPG bytes. prompt is the user's intent text; style is v1/v2/custom."""
    base_name = STYLE_BASES.get(style, STYLE_BASES["default"])
    base_path = ASSETS / base_name
    if not base_path.exists():
        # fallback: synthesize a colored rectangle with text
        img = Image.new("RGB", (width, height), (24, 18, 14))
        d = ImageDraw.Draw(img)
        d.text((40, 40), prompt or "AI Image", fill=(255, 255, 255))
    else:
        img = Image.open(base_path).convert("RGB")
        img = img.resize((width, height), Image.LANCZOS)

    # Title / subtitle extraction (very simple; real imagegen wouldn't take text but we fake the overlay)
    title, subtitle = None, None
    if prompt:
        # Crude: first phrase before "。" is title; rest is subtitle
        parts = re.split(r"[，。,.]+", prompt, maxsplit=1)
        title = parts[0].strip() if parts else None
        subtitle = parts[1].strip() if len(parts) > 1 else None

    if style == "v1":
        _draw_title_v1(img, title, subtitle)
    elif style == "v2":
        _draw_title_v2(img, title, subtitle)
    else:
        # Custom: respect prompt_hints encoded in prompt as "key=value" pairs
        hints = {}
        for tok in (prompt or "").split():
            if "=" in tok:
                k, v = tok.split("=", 1)
                hints[k] = v
        _draw_title_custom(img, title, subtitle, hints)

    # Mild post-process: subtle warm tint
    img = img.filter(ImageFilter.SMOOTH)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue()
