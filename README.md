# Moss Valley

A desktop WebGL scene: a mossy valley at sunset, a shallow rounded stone hatch with two independent halves, scanned rocks and interactive foliage. The page contains a single canvas and no interface or visible text.

## Run

```sh
pnpm install
pnpm dev
```

Build with `pnpm build`, then serve the `dist` directory (`pnpm preview`). Requires Node.js 20.19+ or 22.12+ and a browser with WebGL 2.

## Scene structure

- `src/main.js`: renderer, lighting, texture/model loaders, pointer smoothing, camera rig and render loop.
- `src/environment.js`: sky, terrain, distant hills, scanned landscape rocks and pollen.
- `src/vegetation.js`: instanced foliage and vertex/fragment shader interaction.
- `src/hatch.js`: two independent stone leaves, crack, logo anchor and descent target.
- `src/math.js`: deterministic noise, scatter and shared terrain height.

Future animation can move `left` and `right` along X before animating the camera toward `descentTarget`. `logoAnchor` is reserved above the hatch. These objects are available in `window.sceneRig` during development.

Texture and model sources are recorded in `docs/asset-sources.md`. All runtime assets and Draco/Basis decoders are served locally. No external asset requests are required after the page loads.

Hover response bends and enlarges rooted plants, increases their color/emission and produces a subtle bloom. Motion is time based, pauses when the tab is hidden and respects the system's reduced-motion preference. Desktop resizing updates the camera and framebuffer; there is no separate mobile layout.
