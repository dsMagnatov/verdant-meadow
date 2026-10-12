# Reference assets for the meadow scene

Downloaded on 2026-10-12 for the user-requested local desktop scene. The files below are public assets delivered by the reference websites. Public delivery is not evidence of an open-source license; no reusable asset license or source repository was found in the inspected homepage HTML and JavaScript. This prototype records their provenance and does not publish the site.

All downloaded files live in `public/assets/reference/`. Total: **11,799,374 bytes (11.25 MiB)**.

## Source inventory

| Local file | Bytes | Original URL |
| --- | ---: | --- |
| otherlife-large-rocks.glb | 557,532 | https://www.otherlife.xyz/assets/webgl/large-rocks/large-rocks.glb |
| otherlife-medium-rocks.glb | 322,920 | https://www.otherlife.xyz/assets/webgl/medium-rocks/medium-rocks.glb |
| otherlife-foliage.glb | 1,480,644 | https://www.otherlife.xyz/assets/webgl/foilage/foilage.glb |
| otherlife-rocks-diffuse-2048.ktx2 | 608,210 | https://www.otherlife.xyz/assets/webgl/rocks/diffuse-2048.ktx2 |
| otherlife-rocks-normal-2048.ktx2 | 5,593,008 | https://www.otherlife.xyz/assets/webgl/rocks/normal-2048.ktx2 |
| otherlife-rocks-roughness-2048.ktx2 | 369,994 | https://www.otherlife.xyz/assets/webgl/rocks/roughness-2048.ktx2 |
| otherlife-large-rocks-ao-2048.ktx2 | 310,880 | https://www.otherlife.xyz/assets/webgl/large-rocks/ao-2048.ktx2 |
| otherlife-large-rocks-lightmap-2048.ktx2 | 412,403 | https://www.otherlife.xyz/assets/webgl/large-rocks/lightmap-2048.ktx2 |
| otherlife-medium-rocks-ao-2048.ktx2 | 165,651 | https://www.otherlife.xyz/assets/webgl/medium-rocks/ao-2048.ktx2 |
| otherlife-medium-rocks-lightmap-2048.ktx2 | 320,389 | https://www.otherlife.xyz/assets/webgl/medium-rocks/lightmap-2048.ktx2 |
| otherlife-ferns-diffuse-1024.jpg | 208,566 | https://www.otherlife.xyz/assets/webgl/ferns-diffuse-1024.jpg |
| otherlife-ferns-ao-1024.ktx2 | 135,130 | https://www.otherlife.xyz/assets/webgl/foilage/ferns-ao-1024.ktx2 |
| otherlife-ferns-normal-1024.ktx2 | 148,868 | https://www.otherlife.xyz/assets/webgl/foilage/ferns-normal-1024.ktx2 |
| gladeye-pool-summer.png | 249,287 | https://www.gladeye.com/valley/flowers/pool_summer.png |
| gladeye-pool-winter.png | 915,892 | https://www.gladeye.com/valley/flowers/pool_winter.png |

The source's `foilage` directory is intentionally misspelled; the local model filename uses `foliage`.

## Model inspection and loading

Both rock GLBs declare `KHR_draco_mesh_compression`. Load them with `GLTFLoader` configured with `DRACOLoader`. The foliage GLB is not Draco-compressed. All three declare `KHR_materials_unlit`, contain only a gray `DefaultMaterial`, and have no embedded image references. Replace those placeholder materials with scene materials.

Each rock primitive exposes `POSITION`, `NORMAL`, `TEXCOORD_0`, and `TEXCOORD_1`. Each rock geometry contains 3,672 vertices. The large model contains 21 meshes under `BIG_Rocks_2_UV_MAPS`; the medium model contains 12 meshes under `MID_Rocks_2UVs`. Their parent groups include translations from the original composition, so importing the entire authored scene directly does not place a rock at the new meadow origin.

Recommended extraction: select a mesh, clone its geometry, discard its authored translation/rotation/scale, normalize the geometry's X/Z center, and translate its minimum Y to zero. Preserve both UV attributes. A chosen mesh can then be instanced or assigned an independent new transform.

### Useful meshes and local geometry bounds

| Model / mesh | Local min XYZ | Local max XYZ | Dimensions XYZ | Original node scale |
| --- | --- | --- | --- | --- |
| large / `MainRock` | -0.655868, -0.055450, -0.500192 | 0.652125, 0.557761, 0.497529 | 1.307993, 0.613211, 0.997721 | 1.5, 1.5, 1.5 |
| medium / `Aset_nature_rock_M_xjijbgx_00_LOD0_12` | -0.533895, -0.043758, -0.407874 | 0.532078, 0.457361, 0.405385 | 1.065973, 0.501119, 0.813259 | 0.15, 0.15, 0.15 |
| foliage / `_9857_Var3_LOD0` | -0.279259, -0.042575, -0.220378 | 0.270054, 0.210614, 0.345515 | 0.549313, 0.253189, 0.565893 | approximately 0.5 each |
| foliage / `_wyh8_Var3_LOD0_4_remesh` | -0.299778, -1.873889, -0.041192 | 0.444547, 0.106024, 0.431943 | 0.744325, 1.979913, 0.473134 | approximately 0.2 each |

These are accessor bounds before node transforms, in glTF coordinates with Y up. Do not assume the source author's scene scale corresponds to a chosen real-world meter scale for the new scene. The existing `MainRock` is a solid irregular boulder; it does not contain two opening halves or a ready-made central crack.

The foliage model contains twelve fern meshes with names containing `9857`, each with 726 or 728 vertices, and one hanging vine mesh with a name containing `wyh8`, with 24,006 vertices. For the first meadow scene, cloning one fern geometry is substantially lighter than repeatedly cloning the entire foliage model.

## Textures and materials

All downloaded KTX2 files have `vkFormat=0` and require a Basis-compatible `KTX2Loader`. Set a local Basis transcoder path and call `detectSupport(renderer)`. Rock maps are 2048 x 2048; fern maps are 1024 x 1024. Most use BasisLZ supercompression; the rock normal map uses no supercompression and accounts for almost half of the downloaded bytes.

The original Otherlife scene uses one shared rock diffuse/normal/roughness set, while each rock collection has its own AO and lightmap atlas. Apply diffuse as the color map, normal as the normal map, and roughness as the roughness map. AO and baked lightmap coordinates use the second UV set; in current Three.js this corresponds to `texture.channel = 1` and geometry attribute `uv1`. Preserve each original mesh's atlas UV region. The original lightmap also encodes scene-specific lighting/shadow treatment in custom shader code, so a restrained intensity or omitting it is preferable when placing the geometry under new lighting. Do not assign these AO/lightmap atlases to newly generated hero geometry.

The fern diffuse JPG has a black background and no alpha channel. The original code assigns the same diffuse image to both `map` and `alphaMap`, with the AO and normal maps assigned separately. It uses a double-sided transparent material and additional custom shader work for motion, theme color, frost and projected content. For an independently lit meadow, a double-sided material with `map = fernDiffuse`, `alphaMap = fernDiffuse`, modest `alphaTest`, and normal depth testing can preserve the leaf cutouts without importing the original shaders. Set the external JPG's `flipY` consistently with the imported glTF UV coordinates; Three.js glTF textures conventionally use `flipY = false`.

Treat diffuse/color maps as sRGB and data maps such as AO, normal and roughness as linear. Alpha tests using the JPG's green channel will naturally retain green leaves and reject the black background.

The Gladeye summer and winter images are sprite atlases for individual flowers, grasses and leaves. They are suitable for choosing small plant regions and drawing them on billboards with transparency. The inspected source uses a custom point/sprite shader, seasonal texture mixing, terrain noise and growth parameters rather than fully geometric flower models. The downloaded atlases are reference assets; no Gladeye camera-path GLB or terrain map was needed for this new meadow layout.

## Inspected primary code

- Otherlife scene, model manifest and material assignment: https://www.otherlife.xyz/_next/static/chunks/583.3413852d799b1693.js
- Otherlife Three.js and GSAP application bundle: https://www.otherlife.xyz/_next/static/chunks/pages/_app-52890f5342ba0925.js
- Gladeye scene, sprite shader and texture manifest: https://www.gladeye.com/_next/static/chunks/app/page-4c279de0997d388f.js

Only the focused model and texture files above were downloaded. No full website source, proprietary shader package, or cloned reference page was added to the project.

## CC0 tiling stone for the procedural hatch

The original Otherlife rock diffuse is a model atlas. Applying that atlas to the independently generated central hatch stretched unrelated atlas regions across the surface. The first separate seamless stone PBR candidate was **Rock 01**, by **Rob Tuytel**, from Poly Haven. It provides warm gray weathered solid stone, subtle erosion streaks and mineral speckles. Its fine grain looked too smooth on the broad hatch, so it is retained as a fallback while the coarser Rock Face 03 set below is the preferred hero surface.

- Asset: https://polyhaven.com/a/rock_01
- Official information: https://api.polyhaven.com/info/rock_01
- Official download metadata: https://api.polyhaven.com/files/rock_01
- License: **CC0**, confirmed at https://polyhaven.com/license
- Native physical coverage: **1.5 x 1.5 meters** per tile, according to API dimensions of 1500 x 1500 millimeters.

These files live in `public/assets/stone/`, separate from the reference model atlases. All are **2048 x 2048 JPG**. Their MD5 hashes were verified against the official API metadata after download. Total: **7,781,808 bytes (7.42 MiB)**, below 8 MB.

| Local file | Bytes | MD5 | Original URL |
| --- | ---: | --- | --- |
| rock_01_diff_2k.jpg | 3,020,379 | fd84a894b55e56b17bdfdeec99277f92 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_01/rock_01_diff_2k.jpg |
| rock_01_nor_gl_2k.jpg | 2,989,093 | 1b75b6018dcaa4a6335b9a9b70352651 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_01/rock_01_nor_gl_2k.jpg |
| rock_01_rough_2k.jpg | 1,772,336 | cdaa2b58562517340a9c9d00757cb71d | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_01/rock_01_rough_2k.jpg |

Load with `TextureLoader`. Apply `RepeatWrapping` to all three maps and keep their repeat/offset values synchronized. The diffuse map uses sRGB; the OpenGL normal and roughness maps use linear data. Set a modest normal scale and an approximately 1.5-meter texture repeat in world coordinates, then adjust visually for the hero stone size. These are seamless surface maps, so they do not require the model-specific UV1/AO/lightmap atlas regions.

### Preferred coarse surface: Rock Face 03

Three official 1k diffuse candidates were visually inspected before selecting the final surface: Dark Rock 02, Rock Face and **Rock Face 03**. Rock Face 03 provides broad, irregular eroded stone plates, coarse fissures, darker creases, warm gray/brown variation and small lichen flecks. It reads as a continuous fractured cliff surface rather than loose gravel or cut bricks. It is visibly coarser than the retained Rock 01 fallback.

- Asset: https://polyhaven.com/a/rock_face_03
- Official information: https://api.polyhaven.com/info/rock_face_03
- Official files metadata: https://api.polyhaven.com/files/rock_face_03
- Authors: **Dario Barresi** (photography), **Rico Cilliers** (processing).
- License: **CC0**, https://polyhaven.com/license
- Physical tile coverage: **2.7 x 2.7 meters**, from official metadata dimensions of 2700 x 2700 millimeters.

The selected maps in `public/assets/stone/` are **1024 x 1024 JPG**, totaling **2,712,774 bytes (2.59 MiB)**, below 4 MB. All three MD5 hashes were checked against the official API. The two unused preview files were removed; the existing Rock 01 set remains available.

| Local file | Bytes | MD5 | Original URL |
| --- | ---: | --- | --- |
| rock_face_03_diff_1k.jpg | 927,082 | e4c34abb1aad5befe12754fad507147a | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_diff_1k.jpg |
| rock_face_03_nor_gl_1k.jpg | 1,146,788 | cbd30858439ece391480c5e67e09de89 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_nor_gl_1k.jpg |
| rock_face_03_rough_1k.jpg | 638,904 | bbb2c7dafde3f81808fa7404d4527a56 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_rough_1k.jpg |

Use `TextureLoader`, synchronized repeat/offset on all maps, diffuse sRGB and linear OpenGL normal/roughness data. Start with roughly one tile across the broad hatch to preserve the large plates and fracture scale. Increasing the repeat too far reduces the coarse visual relief to another fine grain surface.
