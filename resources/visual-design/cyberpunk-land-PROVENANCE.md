# Globe geography

Natural Earth land boundaries (public-domain data), redistributed as TopoJSON by [world-atlas](https://github.com/topojson/world-atlas), whose ISC notice is retained in cyberpunk-land-LICENSE.txt. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) explicitly allow modification and redistribution.

The input is the previously archived land-50m.json in the 22-hud reference package. Only the geographic dataset is used. Original animation drawing code, typography, HUD layout, shaders and branding are not copied into the NEXUS renderer.

`node scripts/gen-cyberpunk-land.mjs` decodes the archived topology, omits tiny islands/Antarctica for this decorative globe, simplifies coastlines and rounds coordinates. The generated module records the input hash. It is a decorative network visualization, not a navigation or mapping product.
