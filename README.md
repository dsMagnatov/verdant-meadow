# Moss Valley

A desktop WebGL scene: a luminous green and gold meadow, grouped moss-covered boulders, drifting pollen, wildflowers and a broad two-part stone hatch whose crack continues below the viewport. Scrolling opens the stone leaves and takes the camera underground into a mossy, vaulted rock corridor. A fixed canvas sits behind the Verdant wordmark, a rectangular Menu button with a two-line icon and the owner-supplied two-line hero typography. Menu smoothly blurs the live scene behind four large Instrument Serif links with staggered motion. Home returns to the meadow; Explore follows the existing scroll journey to the tunnel. The Rift stops at the open hatch; Roots stops by the underground vegetation. Links have no decorative arrows, numbering or separators.

## Run

```sh
pnpm install
pnpm dev
```

Build with `pnpm build`, then serve the `dist` directory (`pnpm preview`). Requires Node.js 20.19+ or 22.12+ and a browser with WebGL 2.

## Scene structure

- `src/main.js`: renderer, lighting, texture/model loaders, pointer smoothing, camera rig and render loop.
- `src/menu.js`: modal opening/dismissal, native focus trapping, scroll locking and navigation through the scene.
- `src/environment.js`: emerald sky, terrain, distant hills, moss-covered scanned boulders and drifting luminous pollen.
- `src/vegetation.js`: instanced foliage and vertex/fragment shader interaction.
- `src/dense-grass.js`: fine opaque grass blades, spatial tiles, distance detail levels, coherent wind and rooted cursor parting.
- `src/hatch.js`: two independent stone leaves, crack, logo anchor and descent target.
- `src/glass-logo.js`: the supplied SVG extruded into frosted glass, local reflections and slow vertical-axis rotation.
- `src/scroll-journey.js`: a reversible five-viewport scroll journey, smoothed progress and continuous camera keyframes.
- `src/underground.js`: the real terrain aperture, shaft walls, ledges, arched tunnel and interior lights.
- `src/underground-vegetation.js`: rooted growth, hanging vines and cursor-responsive cave foliage.
- `src/postprocessing.js`: shadow-map ray marching through sunlit air, contact occlusion and soft foreground blur across the lower corners and bottom center.
- `src/hover-light.js`: one shared circular light falloff for grass, ferns and herbs.
- `src/contact-occlusion.js`: depth-based local occlusion shared with the atmosphere shader.
- `src/math.js`: deterministic noise, scatter and shared terrain height.

The hatch leaves slide 3.3 meters in opposite directions before the camera crosses the ground. Their foliage stays attached. The terrain has an actual opening, and the camera descends to Y=-11.4 meters with a forward view into the central tunnel. Scrolling back reverses the same poses and plant growth. `logoAnchor` holds the rotating glass emblem above the hatch. The rig is available in `window.sceneRig` during development.

Texture and model sources are recorded in `docs/asset-sources.md`. All runtime assets and Draco/Basis decoders are served locally. No external asset requests are required after the page loads.

The sky, directional sun and light shafts share one sun direction. A 4096 px shadow map includes moving cutout shadows from ferns, herbs and flowers; low fill light keeps the shaded sides of rocks distinct. Local depth occlusion anchors foliage and moss to surfaces. Volumetric light integrates 24 samples along each view ray, clipped at the visible surface and shadowed by the scene. This is rasterized lighting with ray-marched atmospheric scattering, not hardware ray tracing.

Hover response raises rooted plants by up to 33%, bends them away from the pointer and increases tip glow. Ray proximity also activates tall foliage above the boulders. Plant batches growing on the hatch attach to their respective half; plants on the terrain and boulders keep their own anchors. Floating pollen uses three size groups with softer, dimmer large particles. Motion is time based, pauses when the tab is hidden and respects the system's reduced-motion preference. Desktop resizing updates the camera and framebuffer; there is no separate mobile layout.

Surface grass uses dense, fine blades with darker roots and sunlit tips. The meadow receives a continuous irregular cover; the hatch keeps clear stone between grassy patches and an unobstructed fracture. Spatial batches and distance detail levels reduce invisible and distant geometry. Blade motion runs on the GPU with shared gusts and rooted cursor displacement. Opaque ribbons avoid alpha-card overdraw, and grass receives the existing sun/foliage shadows. Final edge antialiasing softens subpixel strands without a multisample HDR framebuffer. No additional runtime images or models are needed for this grass.

Extra fine grass grows along both fracture banks. Its irregular clearance follows the actual crack, with noise-shaped tufts and a gradual density/height falloff instead of a straight bare strip. Roots remain attached to the moving stone halves; the fracture itself stays open.

The foreground stone grass includes a dense shorter layer of leaning blades underneath the taller strands. This overlaps the gaps between roots and gives the grass patches a continuous dark base. The lower layer uses three triangles per blade and shares existing instanced tiles, wind, pointer response, shadows and distance culling.

The left foreground clearing overrides the exposed-stone grass mask and adds both grass layers on the actual stone/terrain surface. A shared irregular region thins the fern and leafy shrub roots by up to 74%, leaving scattered reactive plants above the grass. Filtering uses a separate random sequence so flowers, boulders and the rest of the meadow keep their positions.

The right foreground uses the same dense grass layers with its own irregular edge and up to 64% shrub thinning. Separate random sequences preserve the established left clearing. Grass hover light follows the fern's warm green/yellow tint, brightening the blade tips while keeping the roots darker.

All foliage uses one screen-space hover light with a smooth, aspect-correct radius of 22.5% of the viewport height. Lighting no longer combines the separate surface/ray proximity fields of tall and short plant layers; those fields still drive rooted motion and matching shadows. The larger foreground blur runs after atmosphere and bloom, so contact shadows soften with the image. A prefiltered quarter-resolution image receives a separable Gaussian blur, then blends across the lower corners and bottom center while leaving the central composition sharp. The small depth-free blur buffers avoid depth feedback and resize with the framebuffer.

The supplied `public/assets/logo/logo.svg` becomes four beveled glass solids above the hatch. Frosted transmission blurs the meadow behind the logo, while clearer rounded edges catch the sun. Its anchor is at Y=3.6 (about 120 px above the first placement at the working desktop viewport). Rotation takes 36 seconds and stops under reduced motion; the logo stays at the surface when scrolling underground. Refraction uses a half-resolution capture, with finite HDR radiance before mip generation to protect bloom from invalid samples. The glass alone uses a generated reflection environment, so the established terrain/plant lighting is preserved.

Subtle upper-left sun shafts follow the projected glass-logo center and soften beyond it. They use the existing shadowed atmospheric integration and fade during descent without adding another full-screen pass.

Hero copy follows the owner's `typogh.jpg` mockup. Instrument Serif supplies the regular and italic text, while Kapakana supplies the decorative P and C initials. Three self-hosted Latin WOFF2 files total about 60 KB. Copy fades and lifts slightly as the hatch opens, leaving the descent clear. The overlay lets pointer input reach the meadow; the Menu button keeps its own keyboard focus and hover states.

Run `node scripts/check-journey.mjs` to check clearance before the camera crosses the ground, continuous forward orientation, reverse scrolling, frame-rate independent damping and reduced-motion behavior. Native scroll remains available with wheel, trackpad and keyboard. Reduced motion removes decorative wind/parallax and scroll damping while retaining the user-controlled journey.
