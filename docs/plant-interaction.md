# Gladeye plant interaction inspection

Inspected 2026-10-12: [live reference](https://www.gladeye.com/), [public application bundle](https://www.gladeye.com/_next/static/chunks/app/page-4c279de0997d388f.js), [summer atlas](https://www.gladeye.com/valley/flowers/pool_summer.png).

## Verified behavior

The reference uses a Three.js point cloud with textured sprites rather than polygonal flowers. Its 1500×1312 atlas has eight columns and seven rows. From the image's top: flower pool 0 occupies rows 0–1; pool 1 row 2; pool 2 rows 3–4; green foliage row 5; dry ground leaves row 6. The green row contains herb/grassy cutouts, not fern fronds.

Pointer coordinates are smoothed at `min(1, 5 * delta)`. The vertex shader compares an aspect-corrected projected plant center to the pointer, deriving a depth-scaled influence and displacement. Distant points move too, contributing broad meadow motion. Active code does not enlarge sprite size on hover. The fragment shader increases flower RGB with the hover value; foliage is excluded. Bloom settings are strength 0.5, threshold 0.4, radius 0.2. Slow shader noise moves sprites and rotates their atlas UVs. Camera breathing offsets Y by 0.02 and Z by 0.12 with a 1.1 frequency.

## Suggested adaptation for this meadow

Use instanced crossed cards for detailed ground cover, plus polygonal fern fronds in the foreground. Preserve real terrain depth and depth testing so the hatch occludes the plants correctly. Texture cards can use row 5 of the atlas; the foreground ferns should have their own shaped geometry or fern alpha texture.

Compute one hover value per plant anchor, not per vertex, to avoid shearing. Project the anchor to NDC, multiply X by viewport aspect, then use a soft radius of 0.17–0.22 NDC units. Fade the effect outside the canvas and behind the camera. Smooth the pointer with `1 - exp(-5 * dt)`.

For a ground-pinned frond with normalized local height `h`, use `h²` as bend weight. Mix a slow wind displacement (0.025–0.07 world units, varied by per-instance seed) with a small movement away from the pointer (0.06–0.13 world units). Make hover expansion explicit: scale local foliage relative to its ground anchor by `1 + 0.10 * hover`. This matches the user's desired slight enlargement even though the reference itself relies mainly on displacement and glow.

Pass hover into the fragment shader. Warm leaf RGB by 15–30%, and add restrained lime-gold emission near tips; cap emission below a flat neon wash. Bloom strength around 0.3 and threshold around 1.0 is a useful starting point with warm sunset lighting. Share uniforms across instanced materials, update only time and the smoothed pointer each frame, and keep roots stationary.

For atlas cards, select column `c` and top-origin row 5: horizontal texture coordinates `[c/8, (c+1)/8]`; Three.js bottom-origin V range `[1/7, 2/7]`. Inset the UV edges slightly to prevent neighboring tiles from bleeding under mipmaps.
