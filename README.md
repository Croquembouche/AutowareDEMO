# Autoware Mini Demo Viewer

A small static, browser-based Autoware/RViz-style visualization demo. It is designed for GitHub Pages and intentionally does **not** run Autoware, ROS 2, RViz, planning, perception, localization, map services, WebSockets, Docker, or any live backend runtime.

The layout intentionally mimics the recent Autoware Universe RViz launch view: the shell uses RViz-like menu bars, tool buttons, a Displays property tree, `AutowareStatePanel`, `ControlModeDisplay`, `Views`, simulated time, and display names inspired by `autoware_launch/rviz/autoware.rviz`.

The app renders a deterministic scripted scene with Three.js:

- a compact Argoverse 2-derived point cloud loaded from `public/maps/pointcloud_map_small.pcd`
- simplified Lanelet2-style road geometry converted from the AV2 vector map into `public/maps/lanelet_demo.json`
- fixed route and ego trajectory JSON files derived from AV2 map-aligned ego pose
- a fixed time-indexed perception object sequence derived from AV2 annotations
- RViz-like layer controls, orbit/pan/zoom camera controls, camera presets, and scripted demo states
- RViz2-style panels and display names such as `PointCloudMap`, `Lanelet2VectorMap`, `PredictedObjects`, `Trajectory`, and `PathWithLaneId`
- a guided static module walkthrough and topic monitor showing how map, localization, perception, planning, control, and vehicle displays relate during an Autoware-style run

## Run Locally

```bash
npm install
npm run dev
```

Open the local Vite URL printed by the command.

## Build Static Files

```bash
npm run build
```

The deployable static output is written to `dist/`.

## GitHub Pages Deployment

This project uses Vite with `base: './'` in `vite.config.js`, so the built files work from a GitHub Pages project URL such as:

```text
https://username.github.io/repo-name/
```

Typical deployment options:

1. Build with `npm run build`.
2. Publish the `dist/` directory with the included `.github/workflows/pages.yml` workflow, or configure your own Pages workflow to run the build and upload `dist/`.

For the included workflow, enable GitHub Pages in the repository settings and choose **GitHub Actions** as the Pages source.

If you prefer an absolute Pages base path, change `base` in `vite.config.js` to your repository path, for example:

```js
base: '/AutowareDEMO/'
```

## Static Architecture

Everything in the viewer is pre-authored static data:

- no ROS 2 nodes
- no RViz process
- no live localization
- no live planning
- no live perception
- no sensor input
- no backend API

The browser performs only rendering, UI toggling, loading static files, and simple interpolation along the fixed ego trajectory.

The Autoware/RViz UI elements are visual approximations only. They are not Qt widgets, RViz plugins, ROS panels, or live topic subscribers.

## Guided Autoware Walkthrough

The right-side panels provide a short deterministic operator flow:

- **Initial Map**: loads `PointCloudMap`, `Lanelet2VectorMap`, localization pose, and the ego vehicle.
- **Planning**: shows a pre-authored route and trajectory, equivalent to inspecting planning output after setting a goal.
- **Perception**: shows fixed AV2 annotation boxes as `PredictedObjects`.
- **Autonomous Drive**: switches the state panel to autonomous mode, plays the pre-authored ego path, and advances static perception frames in sync with playback.
- **Goal Reached**: stops the vehicle at the final pose and leaves the final route/perception evidence visible.

The module flow panel is also static. It highlights which Autoware subsystems are being demonstrated at each scripted step; it does not execute those modules.

The Displays tree supports RViz-style parent toggles for the System, Map, Planning, and Perception groups. These toggles only change Three.js layer visibility; they do not start or stop any ROS nodes.

## Data Files

```text
public/
  maps/
    pointcloud_map_small.pcd
    lanelet_demo.json
  demo/
    route.json
    ego_path.json
    objects_sequence.json
    objects_frame_000.json
    objects_frame_001.json
    objects_frame_002.json
src/
  layers/
    pointcloud.js
    lanelet.js
    route.js
    egoVehicle.js
    objects.js
  timeline.js
  viewer.js
scripts/
  build_av2_demo.py
```

The checked-in demo data is derived from this local AV2 log:

```text
/run/user/1001/gvfs/smb-share:server=10.2.213.244,share=homes/publicDataset/Argoverse2/sensor/val/02678d04-cc9f-3148-9f95-1ba66347dff9
```

The raw AV2 folder is about 1.1 GB and is not committed. GitHub recommends repositories stay near 1 GB, published GitHub Pages sites may be no larger than 1 GB, and normal GitHub files cannot exceed 100 MB. The repository therefore stores deterministic browser-ready chunks instead of the raw sensor log.

Regenerate the static AV2 chunks with:

```bash
python3 scripts/build_av2_demo.py
```

Set `AV2_ROOT=/path/to/Argoverse2` if the dataset is mounted somewhere else.

### Replace the Demo Assets

To replace the demo scene with different preprocessed data:

1. Crop and downsample the point cloud before committing it. Keep it small enough for GitHub Pages and browser rendering.
2. Store the point cloud as a compact browser-friendly file. This demo loads ASCII `.pcd` through Three.js `PCDLoader`; for larger demos, convert to a smaller JSON, binary buffer, or compressed representation.
3. Preprocess Lanelet2 `.osm` data outside the web app into the simplified JSON shape used by `lanelet_demo.json`.
4. Replace `route.json` with a fixed route polyline.
5. Replace `ego_path.json` with fixed timestamped ego poses.
6. Replace `objects_sequence.json` and the manual object frame JSON files with fixed bounding boxes.

Large maps should not be committed directly. Crop to a short road corridor and downsample aggressively.

## Demo States

- **Initial Map**: point cloud and lanelet map
- **Planning**: fixed route and predicted path
- **Perception**: predefined object boxes
- **Autonomous Drive**: fixed ego trajectory playback
- **Goal Reached**: ego vehicle at the final waypoint

All states are deterministic and scripted.
