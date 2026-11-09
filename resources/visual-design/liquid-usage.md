# Liquid Glass integration

- Generated WebGL template: keep `runtime.js` and `components.css` together with the generated HTML. Foreground controls remain normal DOM elements. For source integration, use `liquid-webgl.ts`, `liquid-material-source.ts`, `liquid-template-preset.json` and html2canvas 1.4.1; call `mountLiquidWebGL(root)` after layout and its returned cleanup on unmount.
- Android: use the supplied `liquid-android-reference.kt` and AGSL asset on API 33+. Supply a background target that excludes the glass itself; keep input and touch controls above it. Declare a blur fallback on older systems.
- iOS: use `expo-glass-effect` on supported iOS 26+ configurations, with a declared blur fallback. Pass the App theme explicitly and honor Reduce Transparency. System glass is a separate material from the supplied custom shader.

For continuously changing DOM, the background acquisition must be adapted and measured on the target device; a smooth Canvas demo does not establish DOM capture performance. Preserve bundled license notices. Validate input, scrolling, theme changes and platform fallbacks on the target device. Preset files configure the supplied renderer; they are not native iOS glass parameters.
