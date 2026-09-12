#!/usr/bin/env python3
"""图标生成管线：一条素材（light 用 assets/avatar/icon-frame-light-A.svg，dark 用 icon-frame-dark.svg）出全部图标产物。
   light 的原配色版 icon-frame-light.svg 保留作回退（改 gen-appicon.py 的 SVGS["light"] 指向它再重跑即可）。

两套口径并存，不要混用（混用会出现形状断层 / 图标内容变小）：
  - **包内 mac 图标** assets/icon.icns：满幅直角（图形本体铺满 1024 画布），形状交给
    macOS 26 系统自己套（超椭圆 + 投影）。给自带圆角的图会被系统再套一层，表现为
    图标内容变小——历史踩坑，勿回退。
  - **非 mac 包内图标** assets/icon.png / assets/icon.ico（Windows / Linux）：这两个平台
    不套形状，必须自带形状，故用「本体占画布 80.5% + 超椭圆遮罩」——与 mac 系统渲染
    出来的观感一致。
  - **运行时 Dock 图标** assets/appicon-{light,dark}.png：同样自带形状（`app.dock.setIcon()`
    的图不经过系统图标遮罩流程），随应用主题切换；README 徽标复用这两张。

步骤：
  1. rsvg-convert 渲染衍生 SVG（viewBox 1.5 0 390 390 → 本体 314/390 = 80.5% 内缩）到 1024 母图
     （不用 qlmanage：它的缩略图带不透明白底，会把透明外边变成白色方角）
  2. 套超椭圆遮罩 |x/a|^n + |y/a|^n = 1（n=5，a = 画布半宽 × 0.805），alpha 相乘叠加
  3. 遮罩后的亮色图导出非 mac 包内图标：icon.png（1024）+ icon.ico（16/24/32/48/64/128/256）
  4. 仅 --icns：由同一素材按「裁到本体 → 1024 母图」出满幅直角口径，再打包成 icns

用法：
  python3 scripts/gen-appicon.py          # dock 图标 + 非 mac 包内图标
  python3 scripts/gen-appicon.py --icns   # 额外重建包内 mac 图标（改动品牌图形后才需要）
依赖：rsvg-convert（brew install librsvg）、Python Pillow；--icns 另需 macOS 自带 sips / iconutil
"""
import argparse
import math
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
INSET = 0.805          # macOS 口径：本体占画布比例（314/390）——mac 图标网格如此（Dock、包内图标用）
WIN_INSET = 0.98       # Windows/Linux 口径：形状贴边（这两个系统的图标习惯填满画布；沿用 80.5%
                       # 会让图标比同屏其它应用小一圈——用户实测反馈）
SQUIRCLE_N = 5.0       # 超椭圆指数：≈5 最接近 macOS squircle 观感
BODY_RATIO = 314 / 390
# Windows 图标尺寸档位：含系统常用档 16/20/24/32/40/48/64/96/128/256——缺失的档位由系统从最近档缩放，
# 小档缩放出来的圆角会被抹平（桌面快捷方式在某几档看着是直角）；256 是 Explorer「大图标」与任务栏的必需档
ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (96, 96), (128, 128), (256, 256)]
# icns 里各表示尺寸 → iconset 文件名（iconutil 要求固定命名）
ICNS_REPS = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]

SVGS = {
    # light 指向 A 档配色副本（frame 底色 #D9F5E3 → #C9EED9，用户 2026-09-12 选定）——
    # 影响到 appicon-light.png / icon.png / icon.ico / icon.icns 四条产物；
    # 原配色素材 assets/avatar/icon-frame-light.svg 保留未动，回退只改这一行并重跑 --icns。
    "light": ROOT / "assets/avatar/icon-frame-light-A.svg",
    "dark": ROOT / "assets/avatar/icon-frame-dark.svg",
}

# 图形本体（直角矩形）锚点：裁到它即得满幅直角口径；找不到就必须报错——静默用错口径
# 会直接产出「被系统再套一层」的图标
FRAME_ANCHOR = re.compile(
    r'<clipPath id="frame-clip"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"'
)


def render(svg: Path, out: Path) -> None:
    subprocess.run(
        ["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", str(out), str(svg)],
        check=True,
    )



def write_ico(im: Image.Image, sizes: list[tuple[int, int]], out: Path) -> None:
    """写标准 ICO：每帧 32bpp BMP（BITMAPINFOHEADER 高字段 = 2×H）+ AND 掩码（1 = 透明）。

    不用 Pillow 的 ICO 保存：它默认写 PNG 帧，`bitmap_format="bmp"` 时又省略 AND 掩码——
    这两种"半标准"结构会让 electron-builder 给 exe 注入图标资源那一步出问题，表现为
    「程序本体图标异常（方角）、而 NSIS 编译的卸载程序图标正常」（用户实测分叉）。
    """
    frames: list[bytes] = []
    for w, _h in sizes:
        px = im.resize((w, w), Image.LANCZOS)
        xor = bytearray()
        row_bytes = ((w + 31) // 32) * 4
        mask = bytearray(row_bytes * w)
        for y in range(w - 1, -1, -1):          # BMP 自下而上
            for x in range(w):
                r, g, b, a = px.getpixel((x, y))
                xor += bytes((b, g, r, a))
                if a <= 127:                     # 透明 → AND 掩码该位置 1
                    mask[(w - 1 - y) * row_bytes + (x >> 3)] |= 0x80 >> (x & 7)
        hdr = struct.pack("<IiiHHIIiiII", 40, w, w * 2, 1, 32, 0, len(xor), 0, 0, 0, 0)
        frames.append(bytes(hdr) + bytes(xor) + bytes(mask))

    offset = 6 + 16 * len(frames)
    dirs, blobs = bytearray(), bytearray()
    for (w, _h), blob in zip(sizes, frames):
        dirs += struct.pack("<BBBBHHII", 0 if w >= 256 else w, 0 if w >= 256 else w, 0, 0, 1, 32, len(blob), offset)
        blobs += blob
        offset += len(blob)
    out.write_bytes(struct.pack("<HHH", 0, 1, len(frames)) + bytes(dirs) + bytes(blobs))


def squircle_mask(supersample: int = 4, inset: float = INSET) -> Image.Image:
    """超椭圆遮罩：超采样后降采样，得到平滑抗锯齿边"""
    hi = SIZE * supersample
    a = hi / 2 * inset     # 半轴 = 画布半宽 × 占比
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


def masked(svg: Path, mask: Image.Image, work: Path, tag: str) -> Image.Image:
    """素材 → 1024 母图 → 超椭圆遮罩（自带形状口径）"""
    master = work / f"master-{tag}.png"
    render(svg, master)
    src = Image.open(master).convert("RGBA")
    if src.size != (SIZE, SIZE):
        raise SystemExit(f"母图尺寸异常: {src.size}")
    out = src.copy()
    # alpha 相乘：本体外的透明区保持透明，遮罩外的本体被裁掉
    # （不能用 putalpha 直接替换——遮罩外的透明区会被算成不透明黑）
    out.putalpha(ImageChops.multiply(src.getchannel("A"), mask))
    return out



def shaped_filled(svg: Path, work: Path, tag: str, inset: float = WIN_INSET) -> Image.Image:
    """素材 → 本体铺满画布 → 套贴边超椭圆遮罩（Windows/Linux 口径）。

    与 masked（macOS Dock 口径）只差两处：① viewBox 裁到 frame，让图形铺满画布；
    ② 遮罩半轴按 inset（默认 0.98 贴边）。macOS 本体占 80.5% 是那个系统的图标网格口径，
    Windows/Linux 直接用会显得比同屏其它应用小一圈。
    """
    m = FRAME_ANCHOR.search(svg.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{svg.name}: 未找到 frame-clip 直角矩形，无法定位图形本体")
    x, y, w, h = m.groups()
    derived = work / f"filled-{tag}.svg"
    derived.write_text(
        re.sub(r'viewBox="[^"]*"', f'viewBox="{x} {y} {w} {h}"', svg.read_text(encoding="utf-8"), count=1),
        encoding="utf-8",
    )
    master = work / f"filled-{tag}.png"
    render(derived, master)
    src = Image.open(master).convert("RGBA")
    out = src.copy()
    out.putalpha(ImageChops.multiply(src.getchannel("A"), squircle_mask(inset=inset)))
    return out

def fullbleed(svg: Path, work: Path, tag: str) -> Image.Image:
    """素材 → 满幅直角 1024 母图（裁到本体，形状交给系统套的口径）"""
    m = FRAME_ANCHOR.search(svg.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{svg.name}: 未找到 frame-clip 直角矩形，无法定位图形本体")
    x, y, w, h = m.groups()
    derived = work / f"fullbleed-{tag}.svg"
    derived.write_text(
        re.sub(r'viewBox="[^"]*"', f'viewBox="{x} {y} {w} {h}"', svg.read_text(encoding="utf-8"), count=1),
        encoding="utf-8",
    )
    out = work / f"fullbleed-{tag}.png"
    render(derived, out)
    return Image.open(out).convert("RGBA")


def build_icns(work: Path) -> Path:
    """满幅直角母图（work/fullbleed-master.png）→ icns（sips 出 iconset → iconutil 打包）
    母图不通过参数传：本函数靠 sips 从磁盘读它（调用方负责先落盘）。"""
    iconset = work / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    for size, name in ICNS_REPS:
        subprocess.run(
            ["sips", "-z", str(size), str(size), str(work / "fullbleed-master.png"),
             "--out", str(iconset / name)],
            check=True, stdout=subprocess.DEVNULL,
        )
    dest = ROOT / "assets/icon.icns"
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest)], check=True)
    return dest


def body_ratio(img: Image.Image, threshold: int) -> float:
    box = img.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()
    return (box[2] - box[0]) / img.size[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="生成全部应用图标产物")
    parser.add_argument("--icns", action="store_true",
                        help="额外重建包内 mac 图标 assets/icon.icns（满幅直角口径，改动品牌图形后才需要）")
    args = parser.parse_args()

    work = ROOT / "temp/drafts/appicon"
    work.mkdir(parents=True, exist_ok=True)
    mask = squircle_mask()
    shaped: dict[str, Image.Image] = {}
    for theme, svg in SVGS.items():
        if not svg.exists():
            print(f"缺少素材: {svg}", file=sys.stderr)
            return 1
        img = masked(svg, mask, work, theme)
        shaped[theme] = img
        dest = ROOT / f"assets/appicon-{theme}.png"
        img.save(dest)
        print(f"{dest.name}: 本体占比 alpha>127 {body_ratio(img, 127):.4f} / "
              f"alpha>0 {body_ratio(img, 0):.4f} / 理论 {BODY_RATIO:.4f}")

    # 非 mac 包内图标：Windows / Linux 不套形状，图形要自带形状（贴边口径，见 WIN_INSET）
    light = shaped_filled(SVGS["light"], work, "light")
    png_dest = ROOT / "assets/icon.png"
    light.save(png_dest)
    ico_dest = ROOT / "assets/icon.ico"
    # 不传保存格式参数：按 .ico 扩展名自动选编码器（多尺寸由 Pillow 从 1024 母图 LANCZOS 生成）
    # bitmap_format="bmp"：帧存成 BMP+AND 掩码（万用兼容格式）。Pillow 默认写 PNG 帧——
    # NSIS 编译卸载程序时能正确取用，但 electron-builder 给 exe 注入图标资源那一步对 PNG 帧
    # 支持不佳，会出现"卸载程序图标正常、程序本体图标异常（方角）"的分叉。
    write_ico(light, ICO_SIZES, ico_dest)
    print(f"{png_dest.name}: {light.size[0]}×{light.size[0]} 圆角（Windows/Linux 包内图标）")
    print(f"{ico_dest.name}: {'/'.join(str(w) for w, _ in ICO_SIZES)} 圆角（Windows 包内图标）")

    if args.icns:
        master = fullbleed(SVGS["light"], work, "master")
        master.save(work / "fullbleed-master.png")
        dest = build_icns(work)
        print(f"{dest.name}: 满幅直角（macOS 包内图标，形状由系统套）")
    else:
        print("assets/icon.icns 未改动（满幅直角口径，仅 --icns 时重建）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
