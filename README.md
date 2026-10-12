# Moss Valley

A desktop WebGL scene: a luminous green and gold meadow, grouped moss-covered boulders, drifting pollen, wildflowers and a broad two-part stone hatch whose crack continues below the viewport. The page contains a single canvas and no interface or visible text.

## Run

```sh
pnpm install
pnpm dev
```

Build with `pnpm build`, then serve the `dist` directory (`pnpm preview`). Requires Node.js 20.19+ or 22.12+ and a browser with WebGL 2.

## Scene structure

- `src/main.js`: renderer, lighting, texture/model loaders, pointer smoothing, camera rig and render loop.
- `src/environment.js`: emerald sky, terrain, distant hills, moss-covered scanned boulders and drifting luminous pollen.
- `src/vegetation.js`: instanced foliage and vertex/fragment shader interaction.
- `src/hatch.js`: two independent stone leaves, crack, logo anchor and descent target.
- `src/postprocessing.js`: sunlight shafts and blur restricted to the screen corners.
- `src/math.js`: deterministic noise, scatter and shared terrain height.

Future animation can move `left` and `right` along X before animating the camera toward `descentTarget`. `logoAnchor` is reserved above the hatch. These objects are available in `window.sceneRig` during development.

Texture and model sources are recorded in `docs/asset-sources.md`. All runtime assets and Draco/Basis decoders are served locally. No external asset requests are required after the page loads.

Hover response raises rooted plants by up to 33%, bends them away from the pointer and increases tip glow. Ray proximity also activates tall foliage above the boulders. Plant batches growing on the hatch attach to their respective half; plants on the terrain and boulders keep their own anchors. Floating pollen uses three size groups with softer, dimmer large particles. Motion is time based, pauses when the tab is hidden and respects the system's reduced-motion preference. Desktop resizing updates the camera and framebuffer; there is no separate mobile layout.
