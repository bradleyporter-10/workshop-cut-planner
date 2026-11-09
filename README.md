# Workshop Cut Planner

A local-first woodworking cut-list and cut-layout optimizer, intended to turn components from **SketchUp Free (web)** models into labeled cutting plans for sheet goods and fixed-width lumber.

**Project status: active prototype with robust browser workflow.**

- The browser planner is usable for manual entry, CSV import/export, direct SKP import (beta), optimization, visual review, and print/PDF output.
- The SKP extraction path is still evolving and should be treated as beta until geometry/quantity validation is complete on real project models.
- Generated plans should still be verified before cutting (fit, kerf, sequence feasibility, and part dimensions).

## Goal

1. Export a `.skp` file from SketchUp Free web edition.
2. Extract the individual physical parts from the model with **name, length, width, thickness, and quantity**.
3. Review the extracted parts and assign each to a defined sheet or solid-lumber stock material.
4. Optimize each material group separately, including repeated stock pieces as necessary.
5. View labeled, dimensioned cutting layouts with cuts/kerf marked and print or save them as a PDF.

The user models assemblies from **reusable named components** (e.g., rails/stiles/panels inside doors, and doors/boxes inside larger cabinet assemblies). Some components are made unique when their dimensions differ. Models typically represent **finished visible dimensions**, not hidden tenons, tongues, or grooves; the final cut length may therefore need an explicit allowance.

## Current files

| File | Purpose |
| --- | --- |
| `cut-planner.html` | Single-file, local browser UI and optimization prototype. |
| `extract_skp_parts.py` | Experimental OpenSKP-based SKP-to-CSV extractor. |
| `playroom cabinets (1).skp` | Real SketchUp test model; use to validate component hierarchy, dimensions, and quantity counts. |
| `sketchup-component-review.csv` | Preliminary component-name/classification review; **not** a validated geometry/quantity cut list. |

Keep the SKP test model in a `test-models/` directory if desired; update the sample commands below accordingly. The model is an example input, not source code.

## Run the browser planner

Open `cut-planner.html` in a current desktop browser; no build, backend, login, or database is needed. Click **Load example** and then **Optimize cut plan** to try it.

Alternatively, enter stock materials and parts or import a parts CSV. A part's `material` must match the name of a stock material already defined in the UI. Click **Print / Save PDF** after optimizing; use the browser's **Save as PDF** destination.

The HTML now also supports **Import SKP (beta)** directly in the Parts section. It parses a selected `.skp` in-browser using OpenSKP's JavaScript package, builds grouped part rows (`name/width/length/thickness/quantity`), and auto-creates sheet-stock entries by thickness when needed.

Direct SKP import defaults to **excluding hidden model content** (hidden instances, and hidden layers when layer visibility metadata is available). Use the **Include hidden parts** checkbox in the Parts section to override this for review/debug runs.

After an SKP import, the review panel now includes a **line-by-line override table** for skipped notes that include extracted dimensions (`L/W/T`). Use **Add as part** to insert that specific skipped entry back into the parts list as a single recovered part.

Offline behavior: **double-click `cut-planner.html` and import a SketchUp file directly in Chrome**. The planner loads the prebuilt `vendor/openskp/browser-bundle.js` as a regular local script. The parser, decompression, triangulation, and FlatBuffers code are all included in that bundle; it makes no runtime module imports or network requests.

Keep the `vendor/` folder beside `cut-planner.html` when copying the app. No server, login, npm install, internet connection, or browser security changes are required to use the planner. The original vendored source modules remain in the repository for maintenance.

### Rebuilding the offline SketchUp bundle (developers only)

The generated bundle is included, so ordinary use needs no build. If you update parser dependencies, rebuild with:

```sh
npm ci
npm run build:skp
npm test
```

The build-only esbuild dependency combines `scripts/skp-entry.mjs` and the vendored source modules into a classic browser script. It is not loaded by the planner. This uses esbuild's [browser bundle / IIFE output](https://esbuild.github.io/api/#format-iife).

An optional real-browser check runs the actual planner and imports the sample model over `file://` without a server or security bypass flags:

```sh
python3 tests/browser_skp_smoke.py
```

It uses installed macOS Chrome by default; set `CHROME_BIN` to another Chrome/Chromium executable if needed. `npm test` also parses the real model in a browser-like JavaScript context with network APIs disabled and runs the layout regression tests.

## Publish or share the PWA

The generated `docs/` folder is an installable, offline-capable Progressive Web App. Publish **the whole folder** to static HTTPS hosting. It contains `index.html` (with the parser embedded), `manifest.webmanifest`, `sw.js`, install icons, and `START-HERE.txt`. No account service, backend, CDN, or runtime third-party dependency is required.

For GitHub Pages, commit/push the generated `docs/` files, then select **Settings → Pages → Deploy from a branch → main → /docs** in your repository. Open the resulting HTTPS URL. All paths are relative, so a repository URL such as `/workshop-cut-planner/` is supported. The build does not publish or change GitHub settings for you.

### Install and use offline

1. Visit the hosted site online and wait for **Ready for offline use** at the bottom.
2. Click **Install app** if offered, or use the browser's install option. On iPhone/iPad, the button shows manual **Share → Add to Home Screen** instructions (use Safari if your browser lacks that option). The install button is hidden in standalone/installed app mode and after an installation event. A regular browser tab cannot reliably determine whether the app is installed elsewhere on every platform.
3. Launch from the installed app icon. The planner and SketchUp import work offline after the initial files are cached.

Installation and service-worker caching require **HTTPS**, or localhost for development; they are not available from `file://`. Browser install UI varies. See [MDN's PWA installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Page loads and reloads try the published `index.html` first with the HTTP cache bypassed; if the network fails or takes more than four seconds, the app opens the most recently cached working page. Successful online page loads refresh that offline copy. Other app assets remain cache-first. This means an ordinary reload picks up published HTML changes without a DevTools cache bypass, while offline launches still work. Publish a complete `npm run build:distrib` output, including `docs/sw.js`.

The service worker caches only the packaged app files. Models and projects remain local and are not uploaded or stored in this cache. **Save project** downloads JSON; projects are not automatically saved across closing the app. The app checks for updates on launch, when brought back into view (at most once per minute), when reconnecting, and every five minutes while visible and online. When an update is ready, save your project and select **Refresh app** in the top banner. A slim green banner across the top and a green dot mark an available update; the button’s hover tooltip reminds you to save project JSON files before refreshing. This checks immediately, activates the downloaded update, and reloads only after confirmation. You can also close all app windows/tabs and reopen. Other open windows are not forcibly reloaded. Browser cache eviction/clearing can require another online visit.

You can still send **just `docs/index.html`** for direct offline use: recipients save it locally and double-click it in Chrome. The parser is embedded, and no server, PWA installation, vendor folder, Python, or Node/npm is needed for that mode.

### Build and test (developers only)

```sh
npm run build:distrib
npm test
npm run preview:pwa
```

Open **http://localhost:8000/** for localhost installation/offline testing. Stop the preview with Ctrl+C. Each `npm run build:distrib` increments the patch version in `package.json` (for example, `0.1.0` → `0.1.1`), synchronizes `package-lock.json`, and stamps the new version beside the title in both `cut-planner.html` and `docs/index.html`. Commit the version files along with the generated `docs/` files. Changes belong in `cut-planner.html`, `pwa/`, or the build scripts; regenerate `docs/` before publishing. The builder embeds the parser and PWA client, generates icons, and uses a content-based cache version to invalidate changed app assets. No ZIP, sample models, saved projects, backups, or development tools are included.

Optional browser checks use locally installed Chrome (macOS default; set `CHROME_BIN` for another Chrome/Chromium executable):

```sh
npm run test:pwa:browser
python3 tests/browser_skp_smoke.py docs/index.html
```

The PWA check requires Node 22+ and uses a temporary localhost server/profile. It validates the manifest and subdirectory scope, switches Chrome offline, reloads the app, and imports the sample SKP. The second check verifies direct `file://` operation.

## Sheet layout goals

In **3. Optimize → Sheet layout goal**, choose:

- **Minimum material** (default): preserves the existing search, prioritizing sheet count and fuller early sheets.
- **Balanced — fewer cuts**: considers additional cutting-oriented and consistent-orientation layouts. It scores sheet count, numbered cut operations, and non-square parts placed with their longer dimension across the sheet. It can spend an extra sheet when the improvement justifies it. Extra sheets are capped at the larger of one sheet or 15% of the minimum-material result, rounded down, per material group. For small jobs the smallest possible increase is one whole sheet.

Balanced mode is a heuristic, not a guarantee of minimum cuts or material. It includes the minimum-material plan as a fallback. The sheet count and waste may increase, and some rotations remain necessary to fit parts. This is not a grain-direction constraint. Lumber packing is unchanged by this sheet setting. Optimization passes controls how many alternatives are tried; Balanced mode evaluates additional alternatives and can take longer.

The selected goal is saved in project JSON; older project files default to Minimum material. The result header records which goal produced the displayed layouts. Re-optimize after changing the goal to compare plans.

## Mobile layout

On screens up to 800px wide, materials and parts use compact summary rows that expand into editing cards when selected (one open at a time), with a red remove button available even when a row is closed. The generated parts list and each stock piece’s parts/cut sequence sections start collapsed on mobile and can be opened with Show; they remain expanded on desktop and in print. Result lists become labeled cards, controls wrap with larger touch targets, and diagrams stack above their parts/cut lists. This avoids horizontal scrolling while preserving the desktop table layout and printed output. Projects and SKP import work through the same browser workflow.

## Current planner capabilities

The browser planner currently supports:

- Custom sheet dimensions and thicknesses (commonly 48 × 96 in).
- Fixed-width lumber stock with configurable board length and thickness.
- Multiple named materials, grouped and optimized separately.
- Part name, width, length, thickness, quantity and material assignment.
- Default **0.125 in (1/8 in)** blade kerf and configurable edge trim/margin.
- 90° rotation without grain-direction constraints.
- Sheet and lumber packing using multiple guillotine-cut heuristics. Narrow lumber parts can share the board width side by side, with kerf and margins reserved. Lumber prefers the longer fitting dimension along the board and includes numbered rip cuts and crosscuts; utilization is measured by area.
- Labeled SVG diagrams with stable part-letter IDs (`A..Z`, then `AA..ZZ`) shared across diagrams and parts lists.
- Part names, ID bubbles, and dimensions share reserved spaces inside each part; text adapts to small parts while ID bubbles retain their full size. Dimensions run parallel to the edges they measure.
- Numbered cut-line bubbles for cut sequence tracking on sheets and lumber:
	- Bubbles anchor just beyond the cut start (`from` endpoint).
	- If a bubble overlaps an earlier cut bubble, it anchors at the cut end (`to` endpoint) instead.
	- If both endpoints are crowded, the end anchor is retained rather than drifting along the cut.
- Marked cut lines centered within visible inter-part gaps when a gap exists.
- Identical layouts for the same stock material are consolidated into one screen card and printed layout page. Headings identify the original sheet/board numbers and repeat count; nonconsecutive numbers are listed explicitly. Parts/cut tables on a shared plan apply to each stock piece, while project totals still count all stock pieces and parts.
- Per-layout side tables for each sheet/board card:
	- Parts on this stock piece (label, name, size, quantity).
	- Cut sequence table with cut spans, cut positions, result tags and completion checkboxes. Cut span is the full distance across the current stock, which can include material removed by later cuts; it is not the finished part dimension. Positions use the current piece’s left/top edge or board start in the selected units. When an earlier cut creates that edge, the position references its cut number and accounts for kerf.
- Usage summaries and grouped material stats, including Number of Cuts across all physical stock pieces and area-weighted Total Waste % across sheets and boards (including kerf, trim, and offcuts). Repeated/consolidated layouts still count every copy.
- Print/PDF output tailored for shop use:
	- Dedicated print-root flow (no popup dependency).
	- Cover page with project summary and parts list.
	- One stock layout per printed page with improved color/shading retention.
	- Layout-only printing behavior from the optimized results section.
- CSV parts import/export and JSON project save/open.

## Current limits and caveats

- This is a heuristic optimizer, not a guaranteed minimum-waste solver.
- Diagrams and cut order are planning aids; verify cut feasibility and safe sequence in the shop.
- Direct SKP import remains beta and should be reviewed before production use.
- Auto-created materials from SKP import are thickness-based defaults and should be reviewed/renamed.
- There is no automatic joinery allowance feature yet.

## Recent progress highlights

- Added consistent letter-based part labeling used in both diagrams and table views.
- Added/iterated bubble styling and placement rules for readability on both sheets and lumber.
- Added per-card operations tables (parts summary plus cut sequence tracking).
- Hardened print flow to produce predictable layout pages and a summary cover page.
- Improved marker behavior for special cases:
	- Lumber marker drift eliminated. Narrow lumber diagrams modestly exaggerate board width (at most twice the length scale) to help label readability; cut positions and lengths retain their actual measurements.
	- Sheet and lumber cut markers prefer the start endpoint and fall back to the end on a bubble collision.
- Improved visual cut readability by introducing small inter-part rendering gaps and centering cut lines relative to those visible gaps.

If parser dependencies need refresh/upgrades, re-vendor from npm (example versions that currently work):

```bash
npm pack openskp@1.5.0
npm pack fflate@0.8.2
npm pack earcut@3.1.0
npm pack flatbuffers@25.9.23
```

Then update files under `vendor/` accordingly, keep `vendor/openskp/index.mjs` imports mapped to local relative paths, and run `npm run build:skp` to refresh the included offline bundle.

## CSV interface

The planner and extractor use the same column names (units: **inches**):

```csv
name,width,length,thickness,quantity,material
Cabinet Side,22,30,0.75,4,3/4 Plywood
Door Rail,2.5,20.5,0.75,8,Poplar 2.5in
```

The `material` column names above are *examples*; define matching stock names in the UI before import. An empty material value will not import into the current planner (it reports the row as unmatched), so material selection/mapping is a near-term integration task. A part's thickness must match its assigned stock thickness (currently within 0.001 in).

For imports from SketchUp, **do not silently add joinery allowances**: the extracted dimensions should reflect the actual model, and a later review/editing step should apply allowances intentionally.

## Experimental SKP extraction

The current extractor uses the third-party `openskp` Python library; its API compatibility and geometry interpretation need confirmation on this exact file format.

Prerequisites: Python 3 and a working installation of OpenSKP. Try:

```bash
python -m pip install "openskp>=1.0"
python extract_skp_parts.py "playroom cabinets (1).skp"
```

If the SKP is moved into `test-models/`:

```bash
python extract_skp_parts.py "test-models/playroom cabinets (1).skp"
```

The script is intended to output, alongside the source SKP:

- `playroom cabinets (1)-parts.csv` — candidate individual cutting parts.
- `playroom cabinets (1)-review.csv` — same parts plus diagnostic flags.
- `playroom cabinets (1)-instances.csv` — one row per extracted placed leaf part, for quantity/path verification.

**Important:** These are *intended* outputs. At the time of this README, OpenSKP could not be installed/tested in the prior execution environment, so successful parsing of this particular SKP is **not yet established**. If installation or parsing fails, inspect the parser's actual supported versions/API and adjust the extractor rather than treating missing values as zero or inventing dimensions.

### Current extraction approach and known risks

- Traverse **placed instances recursively**, not merely the component-definition table.
- Count a reused component once per **actual placement**, including repeated instances under different assemblies.
- Ignore unused definitions and avoid double-counting assembly containers.
- Measure each physical part from its definition-local vertex extents, adjusted for instance scale; do not confuse the assembled-world-axis bounding box with part dimensions.
- Currently sort bounding-box dimensions largest → smallest and label them **length, width, thickness**. This assumes each cut part is a reasonably rectangular prism and the smallest dimension is its thickness.
- Components with both their own geometry and child instances are flagged as `assembly-geometry-skipped`, including their measured dimensions in the review note. Child parts are still traversed and counted.
- Groups, loose/raw geometry, missing or hidden entities, mirrored/nonuniform/sheared transforms, nested transforms, units, and multi-solid components may need special handling.
- The transform matrix convention in OpenSKP needs validation against real known geometry, especially rotation, scaling and unit conversion.
- Current hand-maintained `KNOWN_ASSEMBLIES` names are only provisional; prefer actual structural classification over a list of names.
- Separate parts with the same name but different dimensions should remain separate rows. Aggregate instances only when name and actual dimensions agree within a sensible tolerance.

## Verified preliminary component names

The supplied SKP was previously inspected at the name/classification level, and its preliminary inventory was confirmed as plausible by the user. Examples include:

- `Cabinet Side (large)`, `Cabinet Bottom (large)`, `Cabinet Stringer (small)`, `Cabinet Shelf`, `Base Toe Kick (large)`
- `Door Rail`, `Door Stile`, `Door Face`, `Drawer Rail`, `Drawer Stile`, `Drawer Face`
- `Countertop (long)`
- Assembly/container candidates such as `Cabinet Box (large)`, `Cabinet Box (small)`, and `Cab Base (large)`

**Only names and likely part classification have been reviewed; L/W/thickness and quantities are not yet verified.** The first priority is to establish accurate measurements and counts for the real SKP.

## Next development milestone (highest priority)

**Validate SKP → L/W/thickness/quantity**, using `playroom cabinets (1).skp` as the fixture:

1. Run the extractor against the actual model and resolve any parser or SKP-version errors.
2. Inspect definition/instance relationships and develop a clear rule for **assemblies versus physical parts**. Count placed leaves; do not count assembly wrappers as cut parts.
3. For several named components, compare extracted local dimensions with the dimensions displayed in SketchUp Free. Verify units are inches and that rotation does not change the reported part dimensions.
4. Verify repeated parts count correctly through multiple levels of nested component instances, including scaled or mirrored instances.
5. Identify ambiguous geometry, unresolved material/part classification, or invalid thickness and expose it in a review report rather than guessing.
6. Produce a trustworthy `*-parts.csv` plus a diagnostic report, and confirm import compatibility with the browser planner.
7. Add regression tests with small synthetic hierarchies and expected quantities/dimensions, then use the real SKP as an integration fixture.

**Acceptance criteria:** For a representative manually checked selection of cabinet sides, rails, stiles, panels, and reused components, exported dimensions agree with SketchUp within an explicitly defined tolerance; counted quantities match placed instances; no known assembly is double-counted; ambiguous cases are flagged.

## After extraction is verified

- Add a parts-review/import workflow that maps missing `material` values to user-defined stocks.
- Support **separate stock thicknesses** and materials, including common plywood and lumber sizes.
- Add configurable per-part **length/width allowances** (e.g., +1 in total rail length for two 1/2-in tenons), explicitly distinguished from modeled sizes.
- Add tests for sheet/board packing: fit within usable stock, no overlapping parts, correct kerf and margins, feasible guillotine cut tree, proper rotations, correct totals.
- Add configurable lumber grain/orientation constraints; current lumber packing chooses the longer fitting part dimension along the board and reuses remaining width for narrower parts.
- Improve diagram/PDF output, including clear sheet/board numbering, part ID, dimensions, cut order if available, scale and printable labels.
- Explore **direct browser `.skp` upload** after determining if an OpenSKP TypeScript/browser implementation is reliable; retain CSV as a stable fallback.

## Working with Codex / VS Code

Open this folder in VS Code with the Codex extension and ask Codex to read this README and inspect the current files before modifying them. Example initial prompt:

> Continue the Workshop Cut Planner project. Our current priority is validating actual SketchUp component length, width, thickness, and placed quantities from `playroom cabinets (1).skp`. Read `README.md`, `extract_skp_parts.py`, and `cut-planner.html`. First confirm the SKP parser supports this file and inspect its real model hierarchy. Then implement and run reliable extraction with review flags and tests. Do not fabricate geometry measurements or assume the existing extractor is already proven. Preserve the CSV interface used by the browser planner.

Development preferences: keep the project simple and local-first. Prefer readable, well-tested code and **4-space indentation**. Preserve the standalone HTML workflow unless a more complex architecture demonstrably helps the SketchUp parser integration.

## Practical safety check

A cutting diagram is a planning aid, not a substitute for checking physical stock sizes, saw setup, blade thickness, defect locations, required grain direction (if this changes later), and actual joinery requirements. Always verify the cut list and cut positions before cutting material.
