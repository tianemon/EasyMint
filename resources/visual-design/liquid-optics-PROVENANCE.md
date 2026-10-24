# C optical material

Source: https://github.com/sohumsuthar/liquid-glass
Commit: fb0e2dd45c1c76f2385dabffbb448c1099cd19cc
Original: lib/glass-optics.mjs
License: MIT, Copyright (c) 2026 Sohum Suthar. See liquid-optics-LICENSE.txt.

The module's export keywords were mechanically removed inside createGlassOpticsEngine, which returns the functions used by EasyMint. This keeps standalone exported HTML independent of a package loader. The original mathematical functions are otherwise preserved. LIQUID_OPTICS_LICENSE carries the complete license text into exported scripts.

EasyMint's C adaptation uses bezel=10 CSS px, base thickness=0.8 and gain=1.5, with quintic feathering over the inner 40% of the bezel. Reflection is generated from the same surface slope. Preview, project export and comparison candidate share the implementation in app/shared/visual-design/liquid-lens.ts. This is a Web approximation, not Apple's native material renderer.
