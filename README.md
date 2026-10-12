# Moss Valley

A desktop WebGL scene: a luminous green and gold meadow, grouped moss-covered boulders, drifting pollen, wildflowers and a broad two-part stone hatch whose crack continues below the viewport. Scrolling opens the stone leaves and takes the camera underground into a mossy, vaulted rock corridor. The page contains a single fixed canvas and no interface or visible text.

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
- `src/dense-grass.js`: fine opaque grass blades, spatial tiles, distance detail levels, coherent wind and rooted cursor parting.
- `src/hatch.js`: two independent stone leaves, crack, logo anchor and descent target.
- `src/scroll-journey.js`: a reversible five-viewport scroll journey, smoothed progress and continuous camera keyframes.
- `src/underground.js`: the real terrain aperture, shaft walls, ledges, arched tunnel and interior lights.
- `src/underground-vegetation.js`: rooted growth, hanging vines and cursor-responsive cave foliage.
- `src/postprocessing.js`: shadow-map ray marching through sunlit air, contact occlusion and blur restricted to the screen corners.
- `src/contact-occlusion.js`: depth-based local occlusion shared with the atmosphere shader.
- `src/math.js`: deterministic noise, scatter and shared terrain height.

The hatch leaves slide 3.3 meters in opposite directions before the camera crosses the ground. Their foliage stays attached. The terrain has an actual opening, and the camera descends to Y=-11.4 meters with a forward view into the central tunnel. Scrolling back reverses the same poses and plant growth. `logoAnchor` remains reserved above the hatch. The rig is available in `window.sceneRig` during development.

Texture and model sources are recorded in `docs/asset-sources.md`. All runtime assets and Draco/Basis decoders are served locally. No external asset requests are required after the page loads.

The sky, directional sun and light shafts share one sun direction. A 4096 px shadow map includes moving cutout shadows from ferns, herbs and flowers; low fill light keeps the shaded sides of rocks distinct. Local depth occlusion anchors foliage and moss to surfaces. Volumetric light integrates 24 samples along each view ray, clipped at the visible surface and shadowed by the scene. This is rasterized lighting with ray-marched atmospheric scattering, not hardware ray tracing.

Hover response raises rooted plants by up to 33%, bends them away from the pointer and increases tip glow. Ray proximity also activates tall foliage above the boulders. Plant batches growing on the hatch attach to their respective half; plants on the terrain and boulders keep their own anchors. Floating pollen uses three size groups with softer, dimmer large particles. Motion is time based, pauses when the tab is hidden and respects the system's reduced-motion preference. Desktop resizing updates the camera and framebuffer; there is no separate mobile layout.

Surface grass uses dense, fine blades with darker roots and sunlit tips. The meadow receives a continuous irregular cover; the hatch keeps clear stone between grassy patches and an unobstructed fracture. Spatial batches and distance detail levels reduce invisible and distant geometry. Blade motion runs on the GPU with shared gusts and rooted cursor displacement. Opaque ribbons avoid alpha-card overdraw, and grass receives the existing sun/foliage shadows. Final edge antialiasing softens subpixel strands without a multisample HDR framebuffer. No additional runtime images or models are needed for this grass.

Extra fine grass grows along both fracture banks. Its irregular clearance follows the actual crack, with noise-shaped tufts and a gradual density/height falloff instead of a straight bare strip. Roots remain attached to the moving stone halves; the fracture itself stays open.

The foreground stone grass includes a dense shorter layer of leaning blades underneath the taller strands. This overlaps the gaps between roots and gives the grass patches a continuous dark base. The lower layer uses three triangles per blade and shares existing instanced tiles, wind, pointer response, shadows and distance culling.

The left foreground clearing overrides the exposed-stone grass mask and adds both grass layers on the actual stone/terrain surface. A shared irregular region thins the fern and leafy shrub roots by up to 74%, leaving scattered reactive plants above the grass. Filtering uses a separate random sequence so flowers, boulders and the rest of the meadow keep their positions.

Run `node scripts/check-journey.mjs` to check clearance before the camera crosses the ground, continuous forward orientation, reverse scrolling, frame-rate independent damping and reduced-motion behavior. Native scroll remains available with wheel, trackpad and keyboard. Reduced motion removes decorative wind/parallax and scroll damping while retaining the user-controlled journey.
