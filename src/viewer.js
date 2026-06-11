import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { loadPointCloud } from './layers/pointcloud.js';
import { createLaneletLayers } from './layers/lanelet.js';
import { createRouteLayer, createPredictedPathLayer } from './layers/route.js';
import { EgoVehicleLayer } from './layers/egoVehicle.js';
import { createObjectsLayer, updateObjectsLayer } from './layers/objects.js';

const assetBase = import.meta.env.BASE_URL;

const cameraPresets = {
  initial: { position: [24, 24, 24], target: [20, 0, 0] },
  planning: { position: [31, 19, 18], target: [28, 0, 1.5] },
  perception: { position: [23, 12, 13], target: [24, 0, 1.5] },
  drive: { position: [14, 9, 9], target: [17, 0, 0.8] },
  goal: { position: [53, 15, 16], target: [47, 0, 1.2] },
  topDown: { position: [25, 52, 0.01], target: [25, 0, 0] }
};

export class Viewer {
  constructor(container, ui) {
    this.container = container;
    this.ui = ui;
    this.layers = {};
    this.objectFrames = [];
    this.clock = new THREE.Clock();
    this.frameCallbacks = new Set();
    this.currentPerceptionFrame = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x071016);
    this.scene.fog = new THREE.Fog(0x071016, 65, 130);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.labelRenderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 85;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.screenSpacePanning = false;

    this.addBaseScene();
    this.setCameraPreset('initial', false);
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  async load() {
    this.setLoading('Loading point cloud, lanelets, route, trajectory, and perception frames...');

    try {
      const [pointCloud, laneletMap, route, egoPath, ...objectFrames] = await Promise.all([
        loadPointCloud(`${assetBase}maps/pointcloud_map_small.pcd`),
        loadJson(`${assetBase}maps/lanelet_demo.json`),
        loadJson(`${assetBase}demo/route.json`),
        loadJson(`${assetBase}demo/ego_path.json`),
        loadJson(`${assetBase}demo/objects_frame_000.json`),
        loadJson(`${assetBase}demo/objects_frame_001.json`),
        loadJson(`${assetBase}demo/objects_frame_002.json`)
      ]);

      this.objectFrames = objectFrames;
      this.registerLayer('pointCloud', pointCloud);
      Object.entries(createLaneletLayers(laneletMap)).forEach(([name, group]) => this.registerLayer(name, group));
      this.registerLayer('route', createRouteLayer(route));
      this.ego = new EgoVehicleLayer(egoPath);
      this.registerLayer('egoVehicle', this.ego.group);
      this.registerLayer('trajectoryTrail', this.ego.trailGroup);
      this.registerLayer('predictedPath', createPredictedPathLayer(egoPath));
      this.registerLayer('perceptionObjects', createObjectsLayer(objectFrames[0]));

      this.setLoading(`Loaded ${pointCloud.children[0].geometry.getAttribute('position').count} map points and ${laneletMap.lanelets.length} lanelets.`);
      this.setDetail('Initial Map: static point cloud with simplified Lanelet2-style road geometry.');
      return true;
    } catch (error) {
      this.setLoading(error.message, true);
      throw error;
    }
  }

  registerLayer(name, group) {
    this.layers[name] = group;
    this.scene.add(group);
  }

  setLayerVisible(name, visible) {
    if (this.layers[name]) {
      this.layers[name].visible = visible;
    }
  }

  setLayers(visibility) {
    Object.entries(visibility).forEach(([name, visible]) => this.setLayerVisible(name, visible));
  }

  setPerceptionFrame(index) {
    if (!this.objectFrames[index] || !this.layers.perceptionObjects) {
      return;
    }
    this.currentPerceptionFrame = index;
    updateObjectsLayer(this.layers.perceptionObjects, this.objectFrames[index]);
    this.setDetail(`Perception Frame ${index + 1}: ${this.objectFrames[index].objects.length} scripted object boxes.`);
  }

  playEgo() {
    this.ego?.play();
  }

  pauseEgo() {
    this.ego?.pause();
  }

  resetEgo() {
    this.ego?.reset();
    this.updateScrubber();
  }

  setEgoProgress(value) {
    this.ego?.pause();
    this.ego?.setNormalizedTime(value);
    this.updateScrubber();
  }

  setEgoGoal() {
    this.ego?.setToEnd();
    this.updateScrubber();
  }

  setCameraPreset(name, animated = true) {
    const preset = cameraPresets[name] ?? cameraPresets.initial;
    const position = new THREE.Vector3(...preset.position);
    const target = new THREE.Vector3(...preset.target);

    if (!animated) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 0.5;
    let elapsed = 0;
    const callback = (delta) => {
      elapsed += delta;
      const alpha = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - alpha, 3);
      this.camera.position.lerpVectors(startPosition, position, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);
      if (alpha >= 1) {
        this.frameCallbacks.delete(callback);
      }
    };
    this.frameCallbacks.add(callback);
  }

  setStateText(title, detail) {
    this.ui.stateStatus.textContent = title;
    this.setDetail(detail);
  }

  setDetail(message) {
    this.ui.detailStatus.textContent = message;
  }

  setLoading(message, isError = false) {
    this.ui.loadingStatus.textContent = message;
    this.ui.loadingStatus.classList.toggle('error', isError);
  }

  addBaseScene() {
    const ambient = new THREE.AmbientLight(0x9fb7c5, 1.7);
    const directional = new THREE.DirectionalLight(0xffffff, 1.8);
    directional.position.set(12, 24, 18);
    this.scene.add(ambient, directional);

    const grid = new THREE.GridHelper(80, 40, 0x24414d, 0x132832);
    grid.position.y = -0.02;
    this.scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 36),
      new THREE.MeshBasicMaterial({ color: 0x0b1820, transparent: true, opacity: 0.58, side: THREE.DoubleSide })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(25, -0.04, 0);
    this.scene.add(ground);
  }

  updateScrubber() {
    if (this.ui.timelineScrubber && this.ego) {
      this.ui.timelineScrubber.value = Math.round(this.ego.normalizedTime * 100);
    }
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / Math.max(clientHeight, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    this.labelRenderer.setSize(clientWidth, clientHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.ego?.update(delta);
    this.frameCallbacks.forEach((callback) => callback(delta));
    this.controls.update();
    this.updateScrubber();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
