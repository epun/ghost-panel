---
name: 3d-vocabulary
description: >-
  Use when describing, building, or adjusting real-time 3D scenes (Three.js,
  WebGL, React Three Fiber, or any 3D viewport) and you want to turn a vague
  visual intent — "make it shiny", "swoop the camera in", "soften the shadows",
  "it looks flat", "runs slow" — into the precise term plus the parameter an AI
  can actually change. Maps fuzzy 3D descriptions to correct vocabulary for
  materials, lighting, cameras, geometry, rendering, animation, and performance.
---

# 3D Vocabulary

The fastest way to get good 3D out of an AI is to ask for it in the right words.
"Make it shiny" is ambiguous — shiny like wet plastic and shiny like brushed
metal are different parameters. This skill maps vague 3D intent to the precise
term, then to the concrete thing to change.

Companion to Emil Kowalski's `/animation-vocabulary`, aimed at real-time 3D.

## Quick start

When someone describes a 3D look or behavior in fuzzy terms:

1. **Find the precise term** in the Glossary below.
2. **Name it back** so the vocabulary sticks ("you want lower *roughness*, not
   more *metalness*").
3. **Translate it to an action** — the property + direction to change, and in
   Three.js the specific field (e.g. "drop `material.roughness` toward `0.1`").

## Instructions

- **Pick the category first** (material, light, camera, geometry, render,
  animation, performance) — it narrows the term fast.
- **Map fuzzy → precise → action.** Always end on something editable: a
  property and a direction, not just a noun.
- **Prefer real-time-friendly techniques.** Flag offline-only ones (path
  tracing, full GI bakes) when they come up, and offer the real-time
  approximation (IBL, AO maps, contact shadows).
- **Call out cost.** If a request implies many lights, big textures, high poly,
  or transparency sorting, say so and offer the cheaper equivalent.
- **Disambiguate look-alikes.** Dolly vs zoom, metalness vs roughness, bump vs
  normal vs displacement, alpha-blend vs alpha-test — name the difference.
- **Map to controls when relevant.** In this repo (Ghost Panel / Three.js) the
  term usually corresponds to a material/light/camera property or a panel
  control; point at it.

## Examples (vague → precise → action)

- "shiny like plastic" → **low roughness, dielectric** → `roughness ≈ 0.15`,
  `metalness 0`; add **clearcoat** for a wet/lacquered coat.
- "shiny like metal" → **metallic workflow** → `metalness 1`, `roughness
  0.2–0.4`; needs an **environment map** or it reflects nothing.
- "the edges glow / catch light" → **rim light** or **Fresnel** → add a back
  light opposite the key, or raise **sheen**/Fresnel falloff.
- "camera slowly pushes in" → **dolly in** (not zoom) → move the camera forward
  along its view axis; *zoom* changes FOV and feels different.
- "creepy stretched-perspective push-in" → **dolly zoom (vertigo)** → dolly in
  while zooming out (or vice-versa) so the subject stays the same size.
- "soften the harsh shadows" → **soft shadows / bigger light** → larger
  shadow-map size + an **area light** (or larger source); add **contact
  shadows** where objects meet.
- "it looks flat and dead" → missing **AO + GI + three-point light** → add an
  **environment map (IBL)**, ambient occlusion, and a key/fill/rim setup.
- "blocky silhouette" → **low poly / hard normals** → subdivide, switch to
  **smooth (vertex) normals**, and **bevel** sharp edges so they catch light.
- "smeared / stretched texture" → **bad UVs or wrap** → re-**UV unwrap**, or fix
  **tiling/repeat** and **wrap mode**.
- "jaggy edges" → **aliasing** → enable **MSAA** (`antialias: true`) or add
  **SMAA/FXAA** in post.
- "washed out / blown out" → **tone mapping + exposure** → apply **ACES** tone
  mapping and lower **exposure**; check **sRGB** output.
- "colors look muddy/dull" → **color space** → textures as **sRGB**, lighting in
  **linear**, output color-managed.
- "glass that you can see through" → **transmission** (not just opacity) →
  raise `transmission`, set `ior ≈ 1.5`, add roughness for frosted.
- "runs slow / stutters" → too many **draw calls** or high **triangle count** →
  **instance** repeated meshes, **merge** static geometry, add **LOD**,
  **compress textures** (KTX2), enable **frustum culling**.

## Glossary

### Scene & space

- **Scene graph** — the tree of objects; transforms inherit from parent to child.
- **Object3D / node** — a single transformable entity (mesh, light, camera, group).
- **Group / empty** — a parent with no geometry, used to move/rotate children together.
- **Local vs world space** — coordinates relative to the parent vs relative to the scene root.
- **Pivot / transform origin** — the point an object rotates and scales around.
- **Up axis (Y-up vs Z-up)** — which axis is "up"; Three.js/glTF are Y-up, many DCC tools are Z-up.
- **Handedness** — right-handed (Three.js/glTF) vs left-handed; flips Z and winding.

### Transforms

- **Translate / Rotate / Scale** — the three transforms; "TRS" is their stored order.
- **Euler angles** — rotation as X/Y/Z degrees; intuitive but order-dependent.
- **Quaternion** — rotation with no gimbal lock; use for smooth interpolation (slerp).
- **Gimbal lock** — two Euler axes align and you lose a degree of freedom; cure with quaternions.
- **Look-at** — orient an object so its forward axis points at a target.
- **Billboard** — make a plane always face the camera (sprites, labels, impostors).

### Cameras

- **Perspective** — objects shrink with distance (realistic); has a FOV.
- **Orthographic** — no perspective foreshortening (CAD, isometric, 2D-ish).
- **Field of view (FOV)** — the cone of vision; wide = more in frame + distortion, narrow = flatter/telephoto.
- **Focal length** — photographer's way to say FOV; longer = more zoomed/compressed.
- **Near / far clipping planes** — the depth range that renders; too wide a range causes **z-fighting**.
- **Frustum** — the truncated pyramid of what the camera can see.
- **Aspect ratio** — viewport width/height; wrong value squashes the image.
- **Dolly** — physically move the camera toward/away from the subject (changes parallax).
- **Zoom** — change FOV/focal length only (no parallax change); not the same feel as dolly.
- **Truck / Pedestal** — slide the camera sideways / up-down.
- **Pan / Tilt** — rotate the camera left-right / up-down in place.
- **Orbit** — rotate the camera around a target point (the default inspect control).
- **Crane / Boom** — sweep the camera on an arc, usually rising or descending.
- **Depth of field (DoF)** — blur outside the focus distance; set focus distance + aperture/f-stop.
- **Dolly zoom (vertigo / Hitchcock)** — dolly and zoom in opposite directions for a warping effect.

### Geometry & topology

- **Vertex / Edge / Face** — points, the lines between them, and the filled polygons.
- **Triangle / Quad / N-gon** — 3-, 4-, and many-sided faces; GPUs draw triangles.
- **Topology** — how the mesh is wired; clean (even quads) deforms and shades better.
- **Normals** — per-vertex/face direction used for lighting; wrong normals = dark or inside-out.
- **Smooth vs flat shading** — averaged vertex normals (curved look) vs per-face (faceted look).
- **Winding order / backface** — vertex order defines the front; the back is usually culled.
- **UV unwrap / UVs** — the 2D coordinates that pin a texture onto the surface.
- **Bevel / Chamfer** — round or cut a hard edge so it catches a highlight (kills the "CG look").
- **Extrude / Inset** — push a face out into new geometry / shrink it inward.
- **Subdivision** — split faces to add smooth detail (Catmull-Clark).
- **Primitive** — built-in shape: box, sphere, plane, cylinder, torus.
- **Instancing** — draw thousands of copies of one mesh in a single draw call.
- **LOD (level of detail)** — swap to simpler meshes at distance to save cost.
- **Manifold / watertight** — a closed mesh with no holes or non-shared edges (needed for booleans/print).
- **Wireframe** — render only the edges; a debugging/aesthetic mode.

### Materials & shading (PBR)

- **PBR** — physically based rendering; materials defined by real surface properties.
- **Albedo / base color** — the raw surface color with no lighting baked in.
- **Metalness** — 0 = dielectric (plastic, wood), 1 = metal; rarely in-between.
- **Roughness** — how blurred reflections are; low = mirror/glossy, high = matte.
- **Metallic-roughness workflow** — the standard glTF/Three.js PBR inputs.
- **Specular / IOR** — strength/angle of reflection on non-metals; IOR ~1.5 = glass/plastic.
- **Fresnel** — surfaces get more reflective at grazing angles (rim brightening).
- **Emissive** — surface emits its own light/color (screens, neon); doesn't lit others unless bloom/area light.
- **Normal map** — fake surface detail via per-pixel normals; cheap, no silhouette change.
- **Bump / height** — grayscale fake relief (older, weaker than normal maps).
- **Displacement** — actually moves geometry for real relief (needs subdivision; expensive).
- **Ambient occlusion (AO) map** — baked soft contact shadows in crevices.
- **Clearcoat** — a second glossy layer over the base (car paint, lacquer, wet plastic).
- **Sheen** — soft edge glow for cloth/velvet/dust.
- **Transmission / refraction** — real see-through glass/liquid (bends light), beyond simple opacity.
- **Subsurface scattering (SSS)** — light penetrates and glows through skin, wax, marble.
- **Anisotropy** — stretched highlights along a grain (brushed metal, hair, vinyl).
- **Iridescence** — hue shifts with viewing angle (soap bubble, oil slick).
- **Alpha blend vs alpha test** — smooth transparency (sorting cost) vs hard cutout (cheap, for foliage).
- **Double-sided** — render back faces too (for planes, leaves, cloth).
- **Unlit / flat / toon** — ignore lighting / single color / banded cel-shading.

### Textures & color

- **Texture / texel** — the image mapped to a surface / one pixel of it.
- **UV coordinates** — 0–1 mapping of texture onto geometry.
- **Wrap / tiling** — repeat, clamp, or mirror a texture past its edges.
- **Mipmap** — prefiltered smaller copies that kill shimmer at distance.
- **Anisotropic filtering** — keeps textures crisp at grazing angles (floors, roads).
- **Texture atlas** — many images packed into one to cut draw calls.
- **Cubemap / equirectangular** — two ways to store a 360° environment image.
- **HDRI / environment map (IBL)** — a high-dynamic-range surrounding used to light and reflect the scene.
- **sRGB vs linear** — color textures are sRGB; data maps (normal/roughness/AO) must be linear.
- **Texture compression (KTX2 / Basis)** — GPU-friendly compressed textures; far less VRAM than PNG/JPG.

### Lighting

- **Ambient** — flat fill from all directions; cheap but kills depth if overused.
- **Directional (sun)** — parallel rays from one direction; the main outdoor key.
- **Point** — omnidirectional bulb with falloff.
- **Spot** — cone of light with angle and penumbra.
- **Area** — light emitted from a rectangle/disk; gives soft, realistic highlights and shadows.
- **Hemisphere** — sky color above, ground color below; nice cheap ambient.
- **Three-point (key / fill / rim)** — bright key, soft fill to lift shadows, rim to separate from background.
- **Image-based lighting (IBL)** — lighting and reflections from an HDRI environment.
- **Global illumination (GI)** — light bouncing between surfaces; usually baked or approximated in real-time.
- **Ambient occlusion (AO)** — darkening where surfaces meet; adds grounding and depth.
- **Falloff / attenuation** — how light fades with distance (inverse-square is physical).
- **Color temperature (Kelvin)** — warm (~3000K) to cool (~6500K) light color.
- **Intensity** — brightness; watch units (lumens/candela/lux in physical setups).
- **Shadow map / bias** — texture the shadow is rendered into; bias fixes acne/peter-panning.
- **Soft vs hard shadows** — blurry penumbra (big/area light) vs crisp (small/distant light).
- **Contact shadows** — short dark grounding right where objects touch a surface.
- **Baked vs real-time** — precomputed into textures (fast, static) vs computed each frame (dynamic).

### Rendering & post

- **Rasterization** — the fast default: project triangles to pixels.
- **Ray tracing / path tracing** — trace light rays for accurate reflections/GI; mostly offline for the web.
- **Forward vs deferred** — light per object vs per screen-pixel; deferred scales to many lights.
- **Draw call** — one "draw this" command to the GPU; too many = CPU bottleneck.
- **Z-buffer / depth test** — per-pixel depth so near objects hide far ones.
- **Z-fighting** — flickering when two surfaces share depth; fix near/far range or offset.
- **Backface culling** — skip faces pointing away from the camera.
- **Overdraw / transparency sorting** — cost and ordering problems from stacked transparent pixels.
- **Tone mapping (ACES / Reinhard / AgX)** — squeeze HDR light into displayable range; ACES is a safe default.
- **Exposure** — overall brightness multiplier before tone mapping.
- **Color management / gamma** — keep math in linear, output in sRGB so colors are correct.
- **Antialiasing (MSAA / FXAA / SMAA / TAA)** — smooth jagged edges; MSAA hardware, FXAA/SMAA post, TAA temporal.
- **Bloom** — bright areas bleed glow; pair with emissive.
- **SSAO** — screen-space ambient occlusion added at render time.
- **SSR** — screen-space reflections; cheap reflections of on-screen content.
- **Vignette / chromatic aberration / grain** — lens-style post touches; use sparingly.

### Animation & rigging

- **Keyframe / clip / mixer** — posed moments / a named animation / the player that blends clips.
- **Skeletal animation / skinning / bones** — a rig of bones deforms the mesh via weights.
- **Morph targets / blend shapes** — interpolate between stored vertex poses (faces, expressions).
- **IK / FK** — inverse (set the hand, solve the arm) vs forward (rotate each joint) kinematics.
- **Rest / bind pose** — the default neutral pose the rig was bound in.
- **Procedural animation** — driven by code/math (noise, springs, physics) instead of keyframes.
- **Retargeting** — remap one rig's animation onto a different skeleton.

### Performance

- **FPS / frame time** — frames per second / milliseconds per frame (16.6ms = 60fps budget).
- **CPU- vs GPU-bound** — limited by draw calls/logic vs by shading/fill/triangles.
- **Draw calls / batching** — fewer is better; batch or instance to combine them.
- **Triangle / vertex count** — raw geometry load; cut with LOD and decimation.
- **VRAM** — GPU memory; dominated by textures — compress them.
- **Frustum / occlusion culling** — skip what's off-screen / hidden behind other objects.
- **Instancing / merging** — one draw call for many copies / for combined static meshes.
- **Draco / Meshopt** — geometry compression for smaller glTF downloads.

### Assets & formats

- **glTF / GLB** — the web-native 3D format ("JPEG of 3D"); GLB is the single-file binary form.
- **OBJ / FBX / USD(Z)** — older interchange / DCC-heavy / Pixar's scene format (USDZ for AR).
- **Draco** — common glTF mesh compression; needs a decoder at load time.

## Notes for this repo (Ghost Panel / Three.js)

Most terms above map to a Three.js property or a Ghost Panel control:

- Materials → `MeshStandardMaterial` / `MeshPhysicalMaterial` fields
  (`roughness`, `metalness`, `clearcoat`, `transmission`, `ior`, `sheen`,
  `emissive`, `normalMap`, `aoMap`).
- Lighting/reflections → `scene.environment` (IBL), the light types above,
  `light.castShadow` + `shadow.mapSize`.
- Camera → `PerspectiveCamera.fov`/`OrthographicCamera`, near/far, and the
  orbit/dolly/pan controls in the inspector.
- Render/post → `renderer.toneMapping` (ACES), `toneMappingExposure`,
  `antialias`, and the post-processing chain (bloom, SSAO, SMAA).

When a user asks for a look in plain words, name the term, then point at the
exact property/control to change.
