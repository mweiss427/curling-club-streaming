Static Game Stream Info
=======================

Purpose
- Five-tile mosaic that covers 100% of a 1920×1080 canvas. Sheets on the left and right; three stacked frames in the middle. Mirrors the good layout used on sheet-c but adapted to the `Static Game Stream` scene on sheet-a.

Canvas
- Size: 1920×1080 (pixels)
- Coordinate system: origin at top-left; x rightward, y downward

Tile grid (x, y, width, height)
- Left sheet (Near Wall): 0, 0, 640, 1080
- Center-top (Far House): 640, 0, 640, 360
- Center-middle (Scoreboard from Far Wall): 640, 360, 640, 360
- Center-bottom (Near House): 640, 720, 640, 360
- Right sheet (Far Wall): 1280, 0, 640, 1080

Source mapping (sheet-a Static Game Stream)
- Near Wall → Left sheet
- Far House → Center-top
- Far Wall → Right sheet + Scoreboard (duplicate item, cropped later)
- Near House → Center-bottom

Initial configuration
- All crops 0 to start; the grid itself guarantees full coverage with no gaps.
- Rotations remain as in the scene (house cameras are rotated 270°/90° in-source).
- Z-order: Left and Right sheets at the back, three center tiles above them; Scoreboard above other center tiles.

Tuning guidance
- After verifying inputs, crop/zoom each center tile for framing without changing the tile rectangles above.
- Scoreboard: crop the duplicate Far Wall source to the scoreboard area; keep a 16:9 crop where possible.

Notes from sheet-c
- Sheet-c uses a similar concept with strong crops/zooms. This document standardizes the pixel grid so sheet-a can match precisely before applying zoom crops.

