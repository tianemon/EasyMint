#!/usr/bin/env python3
"""生成运行时 Dock 图标 assets/appicon-{light,dark}.png（跟随应用主题）。

口径（与 bundle 图标不同，两者必须并存、不要混用）：
  - bundle 图标 assets/icon.icns：满幅直角，形状交给 macOS 26 系统自己套；
  - 运行时图标（本脚本产物）：本体占画布 80.5% + 超椭圆遮罩 + 四周透明边。
    `app.dock.setIcon()` 的图不经过系统图标遮罩流程，必须自带形状，否则 Dock 里是直角方块。

步骤：
  1. rsvg-convert 渲染衍生 SVG（viewBox 1.5 0 390 390 → 本体 314/390 = 80.5% 内缩）到 1024 母图
     （不用 qlmanage：它的缩略图带不透明白底，会把透明外边变成白色方角）
  2. 套超椭圆遮罩 |x/a|^n + |y/a|^n = 1（n=5，a = 画布半宽 × 0.805），alpha 相乘叠加

用法：python3 scripts/gen-appicon.py
依赖：rsvg-convert（brew install librsvg）、Python Pillow
"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
INSET = 0.805          # 本体占画布比例（314/390）
SQUIRCLE_N = 5.0       # 超椭圆指数：≈5 最接近 macOS squircle 观感
BODY_RATIO = 314 / 390

SVGS = {
    "light": ROOT / "assets/avatar/icon-frame-light.svg",
    "dark": ROOT / "assets/avatar/icon-frame-dark.svg",
}


def render(svg: Path, out: Path) -> None:
    subprocess.run(
        ["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", str(out), str(svg)],
        check=True,
    )


def squircle_mask(supersample: int = 4) -> Image.Image:
    """超椭圆遮罩：超采样后降采样，得到平滑抗锯齿边"""
    hi = SIZE * supersample
    a = hi / 2 * INSET     # 半轴 = 画布半宽 × 本体占比
    c = hi / 2
    steps = 8192
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        cos_t, sin_t = math.cos(t), math.sin(t)
        # 超椭圆参数方程（n>2）：x = a·sign(cos)·|cos|^(2/n)
        x = a * (1 if cos_t >= 0 else -1) * abs(cos_t) ** (2.0 / SQUIRCLE_N)
        y = a * (1 if sin_t >= 0 else -1) * abs(sin_t) ** (2.0 / SQUIRCLE_N)
        pts.append((c + x, c + y))
    mask = Image.new("L", (hi, hi), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    return mask.resize((SIZE, SIZE), Image.LANCZOS)


def body_ratio(img: Image.Image, threshold: int) -> float:
    box = img.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()
    return (box[2] - box[0]) / img.size[0]


def main() -> int:
    work = ROOT / "temp/drafts/appicon"
    work.mkdir(parents=True, exist_ok=True)
    mask = squircle_mask()
    for theme, svg in SVGS.items():
        if not svg.exists():
            print(f"缺少素材: {svg}", file=sys.stderr)
            return 1
        master = work / f"master-{theme}.png"
        render(svg, master)
        src = Image.open(master).convert("RGBA")
        if src.size != (SIZE, SIZE):
            print(f"母图尺寸异常: {src.size}", file=sys.stderr)
            return 1
        out = src.copy()
        # alpha 相乘：本体外的透明区保持透明，遮罩外的本体被裁掉
        # （不能用 putalpha 直接替换——遮罩外的透明区会被算成不透明黑）
        out.putalpha(ImageChops.multiply(src.getchannel("A"), mask))
        dest = ROOT / f"assets/appicon-{theme}.png"
        out.save(dest)
        print(f"{dest.name}: 本体占比 alpha>127 {body_ratio(out, 127):.4f} / "
              f"alpha>0 {body_ratio(out, 0):.4f} / 理论 {BODY_RATIO:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
