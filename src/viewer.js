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
  initial: { position: [32, 78, 128], target: [-22, 1.4, 54] },
  planning: { position: [18, 58, 98], target: [-26, 1.6, 66] },
  perception: { position: [8, 34, 46], target: [-9, 1.1, 20] },
  drive: { position: [4, 30, 36], target: [-14, 1.2, 32] },
  goal: { position: [-18, 46, 128], target: [-48, 3.5, 101] },
  topDown: { position: [-24, 172, 55], target: [-24, 0, 55] }
};

export class Viewer {
  constructor(container, ui) {
    this.container = container;
    this.ui = ui;
    this.layers = {};
    this.objectFrames = [];
    this.objectSequence = [];
    this.clock = new THREE.Clock();
    this.frameCallbacks = new Set();
    this.currentPerceptionFrame = 0;
    this.currentSequenceFrame = -1;
    this.perceptionSequenceMode = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111417);
    this.scene.fog = new THREE.Fog(0x111417, 150, 320);

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
    this.controls.maxDistance = 260;
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
      const [pointCloud, laneletMap, route, egoPath, metadata, objectSequence, ...objectFrames] = await Promise.all([
        loadPointCloud(`${assetBase}maps/pointcloud_map_small.pcd`),
        loadJson(`${assetBase}maps/lanelet_demo.json`),
        loadJson(`${assetBase}demo/route.json`),
        loadJson(`${assetBase}demo/ego_path.json`),
        loadJson(`${assetBase}demo/av2_metadata.json`),
        loadJson(`${assetBase}demo/objects_sequence.json`),
        loadJson(`${assetBase}demo/objects_frame_000.json`),
        loadJson(`${assetBase}demo/objects_frame_001.json`),
        loadJson(`${assetBase}demo/objects_frame_002.json`)
      ]);

      this.objectFrames = objectFrames;
      this.objectSequence = objectSequence.frames ?? objectFrames;
      this.registerLayer('pointCloud', pointCloud);
      Object.entries(createLaneletLayers(laneletMap)).forEach(([name, group]) => this.registerLayer(name, group));
      this.registerLayer('route', createRouteLayer(route));
      this.ego = new EgoVehicleLayer(egoPath);
      this.registerLayer('egoVehicle', this.ego.group);
      this.registerLayer('trajectoryTrail', this.ego.trailGroup);
      this.registerLayer('predictedPath', createPredictedPathLayer(egoPath));
      this.registerLayer('perceptionObjects', createObjectsLayer(this.objectSequence[0] ?? objectFrames[0]));
      this.setMetadata(metadata);

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
    this.currentSequenceFrame = -1;
    this.perceptionSequenceMode = false;
    this.applyObjectFrame(this.objectFrames[index]);
    this.setDetail(`Perception Frame ${index + 1}: ${this.objectFrames[index].objects.length} scripted object boxes.`);
  }

  applyObjectFrame(frameData) {
    if (!frameData || !this.layers.perceptionObjects) {
      return;
    }
    updateObjectsLayer(this.layers.perceptionObjects, frameData);
    if (this.ui.activeObjectFrame) {
      const frameLabel = frameData.sourceFrameIndex ?? frameData.demoFrame ?? 0;
      this.ui.activeObjectFrame.textContent = `${frameLabel}`;
    }
  }

  syncPerceptionToPlayback() {
    if (!this.perceptionSequenceMode || !this.ego || !this.objectSequence.length || !this.layers.perceptionObjects?.visible) {
      return;
    }
    const egoSourceFrame = this.ego.currentSourceFrameIndex;
    let nearestIndex = this.objectSequence.findIndex((frame) => frame.sourceFrameIndex === egoSourceFrame);
    if (nearestIndex < 0) {
      nearestIndex = Math.min(this.ego.currentFrameIndex ?? 0, this.objectSequence.length - 1);
    }
    if (nearestIndex !== this.currentSequenceFrame) {
      this.currentSequenceFrame = nearestIndex;
      this.applyObjectFrame(this.objectSequence[nearestIndex]);
    }
  }

  playEgo() {
    this.perceptionSequenceMode = true;
    this.ego?.play();
    this.syncPerceptionToPlayback();
  }

  pauseEgo() {
    this.ego?.pause();
  }

  resetEgo() {
    this.perceptionSequenceMode = false;
    this.ego?.reset();
    this.updateScrubber();
  }

  setEgoProgress(value) {
    this.perceptionSequenceMode = true;
    this.ego?.pause();
    this.ego?.setNormalizedTime(value);
    this.updateScrubber();
    this.syncPerceptionToPlayback();
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

  setPanelStatus(status = {}) {
    if (this.ui.operationMode && status.operationMode) {
      this.ui.operationMode.textContent = status.operationMode;
    }
    if (this.ui.routeState && status.routeState) {
      this.ui.routeState.textContent = status.routeState;
    }
    if (this.ui.controlMode && status.controlMode) {
      this.ui.controlMode.textContent = status.controlMode;
    }
    if (this.ui.localizationState) {
      this.ui.localizationState.textContent = 'INITIALIZED';
    }
  }

  setMetadata(metadata) {
    if (!metadata) {
      return;
    }
    if (this.ui.datasetName) {
      this.ui.datasetName.textContent = metadata.source ?? 'Static dataset';
    }
    if (this.ui.datasetLog) {
      this.ui.datasetLog.textContent = metadata.logId ? `${metadata.logId.slice(0, 8)}...` : 'n/a';
      this.ui.datasetLog.title = metadata.logId ?? '';
    }
    if (this.ui.pointCount) {
      this.ui.pointCount.textContent = `${metadata.exportedPointCount ?? 0}`;
    }
    if (this.ui.laneletCount) {
      this.ui.laneletCount.textContent = `${metadata.exportedLanelets ?? 0}`;
    }
    if (this.ui.syncFrameCount) {
      this.ui.syncFrameCount.textContent = `${metadata.syncFrames ?? 0}`;
    }
    if (this.ui.objectFrameCount) {
      this.ui.objectFrameCount.textContent = `${metadata.exportedObjectSequenceFrames ?? this.objectSequence.length}`;
    }
  }

  setDetail(message) {
    this.ui.detailStatus.textContent = message;
  }

  setLoading(message, isError = false) {
    this.ui.loadingStatus.textContent = message;
    this.ui.loadingStatus.classList.toggle('error', isError);
  }

  addBaseScene() {
    const ambient = new THREE.AmbientLight(0xb9c7d0, 1.45);
    const directional = new THREE.DirectionalLight(0xffffff, 1.8);
    directional.position.set(12, 24, 18);
    this.scene.add(ambient, directional);

    const grid = new THREE.GridHelper(280, 70, 0x6f7479, 0x2e343a);
    grid.position.set(-10, -0.02, 55);
    this.scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(290, 250),
      new THREE.MeshBasicMaterial({ color: 0x14191d, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-10, -0.04, 55);
    this.scene.add(ground);

    const axes = new THREE.AxesHelper(2.2);
    axes.position.set(0, 0.06, 0);
    this.scene.add(axes);
  }

  updateScrubber() {
    if (this.ui.timelineScrubber && this.ego) {
      this.ui.timelineScrubber.value = Math.round(this.ego.normalizedTime * 100);
    }
  }

  updateStatusOverlay() {
    if (!this.ego) {
      return;
    }
    const time = this.ego.normalizedTime * this.ego.duration;
    if (this.ui.simTime) {
      this.ui.simTime.textContent = time.toFixed(2);
    }
    if (this.ui.activeEgoFrame) {
      this.ui.activeEgoFrame.textContent = `${this.ego.currentSourceFrameIndex ?? 0}`;
    }
    if (this.ui.speedValue) {
      const speed = this.ego.playing ? 21.6 : this.ego.normalizedTime >= 1 ? 0 : 0;
      this.ui.speedValue.textContent = `${speed.toFixed(1)} km/h`;
    }
    if (this.ui.steerValue) {
      const steer = this.ego.playing ? Math.sin(time * 0.8) * 0.08 : 0;
      this.ui.steerValue.textContent = `${steer.toFixed(2)} rad`;
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
    this.syncPerceptionToPlayback();
    this.updateStatusOverlay();
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
