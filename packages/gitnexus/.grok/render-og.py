#!/usr/bin/env python3
"""Render the Nexus Forge 1200×630 share card as a 2× PNG (exact type + graph)."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/workspace/.grok")
FONT_PATH = ROOT / "fonts" / "IBMPlexSans-Variable.ttf"
OUT_2X = ROOT / "og-card-2x.png"

W, H = 1200, 630
SCALE = 2
VOID = (9, 11, 9, 255)
LIME = (214, 255, 74)
PAPER = (230, 234, 220)
PLATE = (18, 22, 18)

# Logical-space graph. Center lockup stays empty.
# Hubs get a ring; other nodes are smaller satellites.
NODES: dict[str, tuple[float, float, str]] = {
    # left DAG
    "a": (72, 78, "sat"),
    "b": (168, 48, "sat"),
    "c": (252, 88, "mid"),
    "d": (96, 168, "sat"),
    "e": (188, 152, "hub"),
    "f": (52, 268, "sat"),
    "g": (158, 292, "mid"),
    "h": (84, 398, "sat"),
    "i": (178, 428, "mid"),
    "j": (58, 522, "sat"),
    "k": (172, 562, "sat"),
    "l": (248, 504, "sat"),
    # right DAG
    "m": (958, 58, "sat"),
    "n": (1082, 44, "sat"),
    "o": (1148, 102, "hub"),
    "p": (1002, 138, "sat"),
    "q": (1112, 182, "mid"),
    "r": (962, 242, "sat"),
    "s": (1142, 286, "sat"),
    "t": (1024, 342, "mid"),
    "u": (1162, 404, "sat"),
    "v": (978, 472, "sat"),
    "w": (1100, 504, "hub"),
    "x": (1170, 562, "sat"),
    "y": (1022, 582, "sat"),
    # top arc
    "t1": (338, 40, "sat"),
    "t2": (478, 26, "sat"),
    "t3": (618, 46, "mid"),
    "t4": (758, 28, "sat"),
    "t5": (858, 56, "sat"),
    # bottom arc
    "b1": (318, 586, "sat"),
    "b2": (468, 558, "sat"),
    "b3": (618, 592, "sat"),
    "b4": (758, 554, "sat"),
    "b5": (878, 576, "sat"),
    # a couple of receding dim nodes
    "z1": (360, 82, "dim"),
    "z2": (830, 76, "dim"),
    "z3": (292, 548, "dim"),
}

EDGES = [
    ("a", "b"),
    ("b", "c"),
    ("a", "d"),
    ("b", "e"),
    ("c", "e"),
    ("d", "e"),
    ("d", "f"),
    ("e", "g"),
    ("c", "t1"),
    ("f", "h"),
    ("g", "i"),
    ("h", "j"),
    ("i", "k"),
    ("i", "l"),
    ("j", "k"),
    ("l", "b1"),
    ("k", "b1"),
    ("t1", "t2"),
    ("t2", "t3"),
    ("t3", "t4"),
    ("t4", "t5"),
    ("t5", "m"),
    ("t3", "z1"),
    ("t4", "z2"),
    ("m", "n"),
    ("n", "o"),
    ("m", "p"),
    ("o", "q"),
    ("p", "q"),
    ("p", "r"),
    ("q", "s"),
    ("r", "t"),
    ("s", "u"),
    ("t", "v"),
    ("u", "w"),
    ("v", "w"),
    ("w", "x"),
    ("w", "y"),
    ("v", "y"),
    ("l", "b1"),
    ("b1", "b2"),
    ("b2", "b3"),
    ("b3", "b4"),
    ("b4", "b5"),
    ("b5", "y"),
    ("b1", "z3"),
]

RADII = {"hub": 7.0, "mid": 5.0, "sat": 3.6, "dim": 2.8}


def plex(size: int, name: bytes) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONT_PATH), size)
    font.set_variation_by_name(name)
    return font


def tracked_width(text: str, font: ImageFont.FreeTypeFont, tracking: float) -> float:
    if not text:
        return 0.0
    return float(sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1))


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: float,
    y: float,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    tracking: float,
) -> None:
    cursor = x
    for ch in text:
        draw.text((cursor, y), ch, font=font, fill=fill)
        cursor += font.getlength(ch) + tracking


def s(v: float) -> int:
    return int(round(v * SCALE))


def main() -> None:
    pw, ph = W * SCALE, H * SCALE
    base = Image.new("RGBA", (pw, ph), VOID)
    draw = ImageDraw.Draw(base)

    # Faint app-matching grid
    grid = 28 * SCALE
    grid_color = (*LIME, 14)
    for x in range(0, pw, grid):
        draw.line([(x, 0), (x, ph)], fill=grid_color, width=1)
    for y in range(0, ph, grid):
        draw.line([(0, y), (pw, y)], fill=grid_color, width=1)

    graph = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    gd = ImageDraw.Draw(graph)

    for a, b in EDGES:
        x1, y1, k1 = NODES[a]
        x2, y2, k2 = NODES[b]
        alpha = 70 if k1 == "dim" or k2 == "dim" else 110
        gd.line(
            [(s(x1), s(y1)), (s(x2), s(y2))],
            fill=(*LIME, alpha),
            width=max(2, s(1.15)),
        )

    for _key, (x, y, kind) in NODES.items():
        r = RADII[kind]
        cx, cy = s(x), s(y)
        rr = s(r)
        alpha = 140 if kind == "dim" else 255
        if kind == "hub":
            ring = s(r + 5.5)
            gd.ellipse(
                [cx - ring, cy - ring, cx + ring, cy + ring],
                outline=(*LIME, 170),
                width=s(1.2),
            )
        gd.ellipse(
            [cx - rr, cy - rr, cx + rr, cy + rr],
            fill=(*LIME, alpha),
        )

    card = Image.alpha_composite(base, graph)
    td = ImageDraw.Draw(card)

    title_font = plex(138 * SCALE, b"SemiBold")
    sub_font = plex(24 * SCALE, b"Regular")
    title_track = 0.16 * 138 * SCALE
    sub_track = 0.08 * 24 * SCALE

    line1, line2 = "NEXUS", "FORGE"
    subtitle = "Rebuild specification for GitNexus"
    w1 = tracked_width(line1, title_font, title_track)
    w2 = tracked_width(line2, title_font, title_track)
    ws = tracked_width(subtitle, sub_font, sub_track)

    line_h = 138 * SCALE * 0.88
    rule_h = 2 * SCALE
    gap_title = 4 * SCALE
    gap_rule_top = 24 * SCALE
    gap_rule_bot = 18 * SCALE
    sub_h = 24 * SCALE

    block_h = line_h * 2 + gap_title + gap_rule_top + rule_h + gap_rule_bot + sub_h
    block_w = max(w1, w2, ws)
    origin_x = (pw - block_w) / 2
    origin_y = (ph - block_h) / 2

    y = origin_y
    draw_tracked(td, line1, origin_x + (block_w - w1) / 2, y, title_font, (*LIME, 255), title_track)
    y += line_h + gap_title
    draw_tracked(td, line2, origin_x + (block_w - w2) / 2, y, title_font, (*LIME, 255), title_track)
    y += line_h + gap_rule_top
    rule_w = 72 * SCALE
    rx = (pw - rule_w) / 2
    td.rectangle([rx, y, rx + rule_w, y + rule_h], fill=(*LIME, 220))
    y += rule_h + gap_rule_bot
    draw_tracked(td, subtitle, origin_x + (block_w - ws) / 2, y, sub_font, (*PAPER, 255), sub_track)

    print(
        f"lockup_w={block_w / SCALE:.0f}px ({block_w / SCALE / W:.0%} of width) "
        f"lockup_h={block_h / SCALE:.0f}px origin_y={origin_y / SCALE:.0f}"
    )
    card.convert("RGB").save(OUT_2X, "PNG")
    print(f"wrote {OUT_2X} {card.size}")


if __name__ == "__main__":
    main()
