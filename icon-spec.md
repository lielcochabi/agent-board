# Draw the emblem for {{name}}

This is a one-time drawing job. {{name}} ({{role}}) needs a small animated emblem for the Agent Board.

**Goal of the agent:** {{goal}}
**What the user asked for:** {{brief}}

If the user described an icon, draw that. Otherwise invent one visual metaphor that says what this agent does at a glance (not a generic gear, brain or robot). One clear idea, drawn with few strokes.

## Write one file

Write `{{svgFile}}`, then move `{{requestFile}}` into `{{doneDir}}` (create the folder if needed). Touch nothing else.

## The format (anything else is rejected)

- One `<svg viewBox="0 0 64 64">` element. No width, height, text, script, image, defs, use, style tags or colours.
- Allowed elements: `g path circle ellipse rect line polyline polygon`. At most 80 shapes, groups nested at most 3 deep.
- Allowed attributes: `d points cx cy r rx ry x y width height x1 y1 x2 y2 stroke-width opacity fill-opacity stroke-opacity pathLength fill stroke stroke-linecap stroke-linejoin stroke-dasharray transform class style`.
  - `fill` and `stroke` may only be `none` or `currentColor`. The board colours the emblem by state (grey idle, green running, amber blocked, red failed).
  - `transform` may only use `translate()`, `rotate()` and `scale()`.
  - `style` may only set `--dl` (animation delay) and `--dur` (duration), in seconds, like `style="--dl:.4s"`.
- Keep everything inside the circle of radius 28 around (32, 32). The board already draws the outer ring.

## Look

Same visual language as the other emblems: outline strokes, round caps.

- `ln`: outline (fill none, 1.5 px stroke, round caps). The main look.
- `faint`: add to `ln` for secondary detail at lower opacity.
- `fill`: solid shape for small accents (dots, tips).
- `wedge`: very light solid area, for example a sweep or glow.

## Motion

Only a working agent animates, so make the motion mean the job: a beam sweeping, a pen writing, cells lighting up. Put the loop on a few elements by adding class `a` plus one animation class:

- `k-spin`: rotate forever. Add class `c` to rotate around the icon centre.
- `k-pulse`: fade in and out like a lamp.
- `k-bob`: float up and down a little.
- `k-wave`: stretch vertically like an audio bar. Add class `o`.
- `k-ping`: pop in and fade, like a blip or a ripple. Add class `o`. Start with `opacity="0"`.
- `k-draw`: draw a line along its length. Also add class `draw` and `pathLength="1"` on that path.
- `k-flash`: blink.

Stagger repeated elements with `style="--dl:.3s"`, `--dl:.6s` and so on. Elements without class `a` stay still. Class `o` makes an element scale or turn around its own centre.

## Example (a lighthouse)

```
<svg viewBox="0 0 64 64">
  <path class="ln" d="M27 50 L30 26 H34 L37 50 Z"/>
  <path class="ln faint" d="M24 50 H40"/>
  <circle class="fill a k-pulse" cx="32" cy="22" r="3"/>
  <path class="wedge a k-pulse" d="M32 22 L54 15 L54 29 Z"/>
  <path class="wedge a k-pulse" style="--dl:1.2s" d="M32 22 L10 15 L10 29 Z"/>
</svg>
```

When you have written the file, say in one line what you drew.
