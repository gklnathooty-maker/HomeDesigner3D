# HomeDesigner 3D

Turn a floor plan picture into a 3D home you can edit, furnish, paint, landscape and walk through.

## Quick start (Windows)

**Easiest: the ready-made app** (`HomeDesigner3D-Windows.zip`)
1. Unzip it anywhere.
2. Double-click **HomeDesigner 3D.exe**. Nothing to install.

**From the source code**
1. Install Node.js (LTS) from https://nodejs.org
2. Double-click **START-HERE.bat** (first run installs components, then the app opens).

To make a proper installer (Setup .exe) to share: double-click **BUILD-INSTALLER.bat** (output goes to `dist`).

Command line: `npm install`, then `npm start`. Run the automated checks with `npm test` (Linux, needs xvfb).

## Using the app

| Step | What to do |
|---|---|
| 1. Floor plan | **Take photo** of a paper plan (phone/tablet) or **Upload image** (or drag and drop a picture). Thin lines, text, furniture and stairs are ignored; only thick wall lines become walls. Turn on **Photo of paper plan** for shadows or grey paper. **Wall line thickness** can be set by hand. Then select one wall, type its real length and press **Scale plan to this wall**. Set the real **house width** in metres. Adjust **Wall darkness** if walls are missed or text is picked up. **Show my plan image on the floor** lets you compare or trace. |
| 2. Floors | Tabs switch between **Ground**, **Floor 1**, ... (up to 6). **Add floor**, **Copy walls up** (new floor with the same outline), **Remove top**, **Show all floors**. |
| 3. Build | **Draw wall** (click corners, double-click to finish), **Add door**, **Add window** (click on a wall), **Measure** (click two points), **Delete**. **Stairs** join one floor to the next and cut the opening in the floor above. **Railing** for balconies and landings. |
| 3b. Build from measurements | **Add wall by dimensions**: type start position (X, Z), length and direction to create a wall. **Build outline**: enter house width and depth, then list partition walls as "x1 z1 x2 z2" coordinates. When a wall is selected, edit its length in the properties panel. |
| 4. Furniture | 70+ items in categories (living, bedroom, kitchen, bathroom, office, decor, garden, exterior) with search. Click an item, then drag it into place. The panel at top-left rotates, copies, deletes and resizes. |
| 5. Paint & materials | Select a wall or item and click a color. Wall materials: plain, brick, stone, tile, wood, stripes, plaster. Floor materials: wood, tile, marble, carpet, concrete. **Apply to all walls on this floor** copies a wall's look to the rest. |
| 6. Roof & view | **Roof** cycles none / flat / pitched (with its own color). **Dimensions** shows wall lengths and room areas. **Walk inside** (W A S D + mouse, Shift to run, walk into stairs to climb), **Fly-around** tour, **Top view**, **See inside**, **Day / night**, **Save picture**. |
| 7. My 3D models | **Import .glb / .gltf** brings in realistic furniture from any free model site. Imported models are listed under "My models" and are stored inside saved project files. |

Shortcuts: `R` rotate - `Del` delete - `Ctrl+Z` / `Ctrl+Y` undo / redo - `Ctrl+D` copy - `Ctrl+S` save - arrow keys nudge the selected item - `Esc` cancel - `F11` full screen (desktop app).

Mouse: drag empty space to rotate the view, right-drag to pan, wheel to zoom.

Your work is saved automatically and restored next time. **Save / Open** use `.json` project files.

## Android
See `ANDROID-BUILD.md` to build the APK for your phone.

## Notes and limits
- Wall detection finds straight horizontal and vertical walls. Diagonal or curved walls: draw them by hand with the plan image shown underneath.
- Doors and windows are not detected from the picture; add them with the tools.
- The built-in furniture is detailed low-poly modelling (textured wood, cushions, handles, glass), not photographs. For photo-realistic pieces import `.glb` models.
- The pitched roof is a simple gable over the outline of the top floor, so L-shaped houses get a roof over their bounding box.
- Room areas are net floor area (inside wall to inside wall).

## Automated tests
`npm test` (Linux, needs xvfb) opens the app in a real window, drags furniture with the mouse, draws walls, adds doors, climbs the stairs, checks the roof, dimensions, textures, model import and renders every catalog item.

## Project layout
- `main.js` Electron window
- `src/index.html` interface
- `src/app.js` 3D editor (bundled to `src/app.bundle.js` by `npm run build`)
- `src/furniture.js` furniture and garden models
- `src/textures.js` generated wall, floor and ground materials
- `src/detect.js` floor plan wall detection
- `test/` automated headless tests
