# Autoware Mini Demo Viewer

A small static, browser-based Autoware/RViz-style visualization demo. It is designed for GitHub Pages and intentionally does **not** run Autoware, ROS 2, RViz, planning, perception, localization, map services, WebSockets, Docker, or any live backend runtime.

The layout intentionally mimics the recent Autoware Universe RViz launch view: the shell uses RViz-like menu bars, tool buttons, a Displays property tree, `AutowareStatePanel`, `ControlModeDisplay`, `Views`, simulated time, and display names inspired by `autoware_launch/rviz/autoware.rviz`.

The app renders a deterministic scripted scene with Three.js:

- a tiny synthetic point cloud map loaded from `public/maps/pointcloud_map_small.pcd`
- simplified Lanelet2-style road geometry loaded from `public/maps/lanelet_demo.json`
- fixed route and ego trajectory JSON files
- fixed perception object frames
- RViz-like layer controls, orbit/pan/zoom camera controls, camera presets, and scripted demo states
- RViz2-style panels and display names such as `PointCloudMap`, `Lanelet2VectorMap`, `PredictedObjects`, `Trajectory`, and `PathWithLaneId`

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

## Data Files

```text
public/
  maps/
    pointcloud_map_small.pcd
    lanelet_demo.json
  demo/
    route.json
    ego_path.json
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
```

### Replace the Demo Assets

To replace the placeholder scene with real preprocessed demo data:

1. Crop and downsample the point cloud before committing it. Keep it small enough for GitHub Pages and browser rendering.
2. Store the point cloud as a compact browser-friendly file. This demo loads ASCII `.pcd` through Three.js `PCDLoader`; for larger demos, convert to a smaller JSON, binary buffer, or compressed representation.
3. Preprocess Lanelet2 `.osm` data outside the web app into the simplified JSON shape used by `lanelet_demo.json`.
4. Replace `route.json` with a fixed route polyline.
5. Replace `ego_path.json` with fixed timestamped ego poses.
6. Replace object frame JSON files with fixed bounding boxes.

Large maps should not be committed directly. Crop to a short road corridor and downsample aggressively.

## Demo States

- **Initial Map**: point cloud and lanelet map
- **Planning**: fixed route and predicted path
- **Perception**: predefined object boxes
- **Autonomous Drive**: fixed ego trajectory playback
- **Goal Reached**: ego vehicle at the final waypoint

All states are deterministic and scripted.
