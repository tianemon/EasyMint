# 液态玻璃开源参考研究

研究日期：2026-10-24。目标：为 Em 找到可复用、可比较的材质实现，停止在现有示例中凭描述反复调参。

本轮只研究与归档，没有引入依赖或替换应用实现。下列“核验”指源码阅读、许可证检查和浏览器观察，不代表已完成生产兼容性或性能验证。未运行下载的第三方构建脚本。

## 优先参考

| 项目 | 本轮证据 | 借鉴内容 | 对 Em 的判断 |
| --- | --- | --- | --- |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) | 阅读 `src/index.tsx`、`src/shader-utils.ts`；实看卡片和小按钮在线演示；MIT | 背景变形层与清晰内容分离；边缘遮罩；分通道位移；随指针变化的高光和弹性 | 优先做小型对照样本。React 接入便利，主力 Chromium 路线与 Em 接近；不能据此假定 Safari/Firefox 折射一致 |
| [kube：Refraction with CSS and SVG](https://kube.io/blog/liquid-glass-css-svg/) | 阅读原作者推导和实现说明；未在本轮交互验证文章末尾演示 | 先定义曲面截面，再求法线、折射路径和高光；厚度、倒角宽度和强度有明确含义 | 优先借鉴推导和实验方法。文章不是组件库；未核定其示例代码单独授权，不直接复制入生产 |
| [sohumsuthar/liquid-glass](https://github.com/sohumsuthar/liquid-glass) | 阅读 `lib/glass-optics.mjs`、`css/liquid-glass-core.css`、`PHYSICS.md`；实看在线演示；MIT | 曲面厚度进入位移计算；Fresnel 反射与透射关联；高光独立层；按元素尺寸生成位移图；背景亮度传递校准 | 数学与校准方法值得对照。作者以 macOS 26 控制中心为标定对象，其测量与性能主张未独立复核，不能作为 iOS 27 官方参数或现成视觉标准 |
| [shuding/liquid-glass](https://github.com/shuding/liquid-glass) | 阅读 `liquid-glass.js`；MIT；本轮未运行其控制台脚本 | 短小的 SDF / 位移图实验，便于理解背景真实弯折 | 适合最小材质实验，不等于完整、可直接投产的 React 控件 |
| [naughtyduk/liquidGL](https://github.com/naughtyduk/liquidGL) | 阅读渲染器的 GPU、背景采样、生命周期代码和 LICENSE；实看 Menu Bar 演示 | WebGPU/WebGL 材质、分离的折射/高光参数、可拖动液态控件；共享画布 | 可作效果上限候选。需实测背景采样更新、滚动、缩放、动态 DOM 和释放资源；目前没有在 Em 内做性能对照，不能直接判断优于 SVG |

另发现 [ybouane/liquidglass](https://github.com/ybouane/liquidglass)：具有 WebGL 渲染与 HTML capture 分层，但该次固定提交的文件树未见 LICENSE，GitHub 元数据也未识别授权；暂不列入可直接复用候选。

## 固定源码版本

| 项目 | 阅读提交 |
| --- | --- |
| rdev/liquid-glass-react | `ac48eab18d1f7f444ae30002d240cae29c863a21` |
| shuding/liquid-glass | `a2d2e847f793430e3409a52927af815a23f4d372` |
| sohumsuthar/liquid-glass | `fb0e2dd45c1c76f2385dabffbb448c1099cd19cc` |
| naughtyduk/liquidGL | `88f681ab7035fd55b04f63edff1841e32c4199e9` |
| ybouane/liquidglass | `59af227103795f06421a96e2c7d3dceb081decd2` |

MIT 复用须保留相应版权和许可文本。liquidGL 的 LICENSE 明确只把 `scripts/` 和 `package/` 源码纳入 MIT，排除演示 `assets/` 中的音频、字体等素材。不能因为演示有源码，就连同 Apple Music 界面图、字体、照片一起作为 Em 模板发布。

## 对当前实现的具体诊断

以下是对本地代码与上述参考的比较判断，不是对原生渲染器的逆向结论。

1. **我们有折射公式，但还没有完整材质模型。** 当前位移以圆弧法线乘统一强度近似，厚度没有独立进入路径；反光由另写的 CSS 渐变提供。仅增加强度或阴影，并不会让这些层自然成为同一片玻璃。
2. **“清透”和“体积感”不应相互替代。** 降低底色可使背景透过，但也会让材质消失；加白和加暗又容易产生塑料倒角。应分别校准背景传递、曲面边缘和表面反射。
3. **选中胶囊是短板。** 当前它主要是半透明选中填充，没有自己的折射过程。整根导航的材质和活动控件应分层研究。不能简单嵌套两个 backdrop-filter，需验证合成边界或采用可控的独立背景源。
4. **背景没有受控。** SONORA 的大字封面恰好穿过控件，容易把折射变成可读性噪声；拿不同位置、背景和尺寸的截图比较，无法判断差距来自材质还是场景。
5. **验证结论越界。** 25/57 项单测、类型检查和构建通过，只能说明对应工程检查通过，不能证明“更像 iOS”或“用户更满意”。

## 下一次实现应先交付的对照实验

先制作一个与正式模板分离的材质对照页：当前版本、rdev 原始实现、基于 kube/光学库的候选，共用同一背景、同一尺寸、同一位置。第三方代码先保持原始效果，确认复现成功后再适配 Em。

- 背景：细网格和斜线用于观察弯折；深浅渐变用于观察亮度传递；照片用于观察质感；正文用于检验可读性。
- 形状：圆形按钮、横向胶囊、导航底板、活动选中胶囊。导航底板与选中胶囊分别校准。
- 状态：静止、经过背景交界、滚动、按下、拖动和释放；不能仅提交一张最好看的静态图。
- 每轮保留并列的前后版本，只改一组参数。先确认视觉方向，再验证性能、无障碍、组件 API 和导出一致性。
- 若 SVG 候选已经达到目标，不因 GPU 路线更复杂就更换；若主要差距确实是采样、曲面或材质合成，再对照 GPU 方案。

在线演示：[rdev](https://liquid-glass.maxrovensky.com/)、[sohumsuthar](https://sohumsuthar.github.io/liquid-glass/demo/)、[liquidGL Menu Bar](https://liquidgl.naughtyduk.com/demos/menu-bar)。这些链接用于参考，不作为应用的运行依赖。
