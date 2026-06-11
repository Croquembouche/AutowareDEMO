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
  initial: { position: [32, 78, -128], target: [-22, 1.4, -54] },
  planning: { position: [18, 58, -98], target: [-26, 1.6, -66] },
  perception: { position: [8, 34, -46], target: [-9, 1.1, -20] },
  drive: { position: [4, 30, -36], target: [-14, 1.2, -32] },
  goal: { position: [-18, 46, -128], target: [-48, 3.5, -101] },
  topDown: { position: [-24, 172, -55], target: [-24, 0, -55] }
};

const overlayPalette = {
  vehicle: '#ffa23a',
  pedestrian: '#ff4d88',
  cyclist: '#b7ff3d',
  unknown: '#c7d2fe'
};

export class Viewer {
  constructor(container, ui) {
    this.container = container;
    this.ui = ui;
    this.layers = {};
    this.objectFrames = [];
    this.objectSequence = [];
    this.cameraManifest = null;
    this.activeCameraId = 'ring_front_center';
    this.activeCameraFrame = -1;
    this.followEgo = false;
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
    this.controls.addEventListener('start', () => {
      if (this.followEgo) {
        this.followEgo = false;
        this.setCameraBadge('orbit / pan / zoom');
      }
    });

    this.addBaseScene();
    this.setCameraPreset('initial', false);
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  async load() {
    this.setLoading('Loading point cloud, lanelets, route, trajectory, and perception frames...');

    try {
      const [pointCloud, laneletMap, route, egoPath, metadata, objectSequence, cameraManifest, ...objectFrames] = await Promise.all([
        loadPointCloud(`${assetBase}maps/pointcloud_map_small.pcd`),
        loadJson(`${assetBase}maps/lanelet_demo.json`),
        loadJson(`${assetBase}demo/route.json`),
        loadJson(`${assetBase}demo/ego_path.json`),
        loadJson(`${assetBase}demo/av2_metadata.json`),
        loadJson(`${assetBase}demo/objects_sequence.json`),
        loadJson(`${assetBase}demo/camera_manifest.json`),
        loadJson(`${assetBase}demo/objects_frame_000.json`),
        loadJson(`${assetBase}demo/objects_frame_001.json`),
        loadJson(`${assetBase}demo/objects_frame_002.json`)
      ]);

      this.objectFrames = objectFrames;
      this.objectSequence = objectSequence.frames ?? objectFrames;
      this.cameraManifest = cameraManifest;
      this.activeCameraId = cameraManifest.cameras?.[0]?.id ?? this.activeCameraId;
      this.registerLayer('pointCloud', pointCloud);
      Object.entries(createLaneletLayers(laneletMap)).forEach(([name, group]) => this.registerLayer(name, group));
      this.registerLayer('route', createRouteLayer(route));
      this.ego = new EgoVehicleLayer(egoPath);
      this.registerLayer('egoVehicle', this.ego.group);
      this.registerLayer('trajectoryTrail', this.ego.trailGroup);
      this.registerLayer('predictedPath', createPredictedPathLayer(egoPath));
      this.registerLayer('perceptionObjects', createObjectsLayer(this.objectSequence[0] ?? objectFrames[0]));
      this.setMetadata(metadata);
      this.setupViewModeControls();
      this.setupCameraTabs();
      this.syncCameraFrame();

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

  setupViewModeControls() {
    this.ui.viewModeButtons?.forEach((button) => {
      button.addEventListener('click', () => this.setViewMode(button.dataset.viewMode));
    });
  }

  setViewMode(mode) {
    const cameraMode = mode === 'cameras';
    if (this.ui.cameraPanel) {
      this.ui.cameraPanel.hidden = !cameraMode;
    }
    this.ui.viewModeButtons?.forEach((button) => {
      button.classList.toggle('active', button.dataset.viewMode === mode);
    });
    if (cameraMode) {
      this.syncCameraFrame(true);
    }
  }

  setupCameraTabs() {
    if (!this.ui.cameraTabs || !this.cameraManifest?.cameras?.length) {
      return;
    }
    this.ui.cameraTabs.replaceChildren();
    this.cameraManifest.cameras.forEach((camera) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = camera.label;
      button.dataset.cameraId = camera.id;
      button.classList.toggle('active', camera.id === this.activeCameraId);
      button.addEventListener('click', () => {
        this.activeCameraId = camera.id;
        this.ui.cameraTabs.querySelectorAll('button').forEach((item) => {
          item.classList.toggle('active', item.dataset.cameraId === this.activeCameraId);
        });
        this.syncCameraFrame(true);
      });
      this.ui.cameraTabs.appendChild(button);
    });
  }

  syncCameraFrame(force = false) {
    if (!this.cameraManifest?.frames?.length || !this.ego || !this.ui.cameraImage) {
      return;
    }
    const egoSourceFrame = this.ego.currentSourceFrameIndex ?? 0;
    let frame = this.cameraManifest.frames.find((item) => item.sourceFrameIndex === egoSourceFrame);
    if (!frame) {
      frame = this.cameraManifest.frames[Math.min(this.ego.currentFrameIndex ?? 0, this.cameraManifest.frames.length - 1)];
    }
    if (!frame) {
      return;
    }
    const imagePath = frame.images?.[this.activeCameraId];
    if (!imagePath) {
      return;
    }
    if (force || frame.sourceFrameIndex !== this.activeCameraFrame || this.ui.cameraImage.dataset.cameraId !== this.activeCameraId) {
      this.activeCameraFrame = frame.sourceFrameIndex;
      this.ui.cameraImage.src = `${assetBase}${imagePath}`;
      this.ui.cameraImage.dataset.cameraId = this.activeCameraId;
      this.renderCameraOverlay(frame);
      const camera = this.cameraManifest.cameras.find((item) => item.id === this.activeCameraId);
      if (this.ui.activeCameraName) {
        this.ui.activeCameraName.textContent = camera?.label ?? this.activeCameraId;
      }
      if (this.ui.activeCameraFrame) {
        this.ui.activeCameraFrame.textContent = `${frame.sourceFrameIndex}`;
      }
    }
  }

  renderCameraOverlay(frame) {
    if (!this.ui.cameraOverlay || !this.ui.cameraStage) {
      return;
    }
    const size = frame.sizes?.[this.activeCameraId] ?? [640, 480];
    const overlays = frame.overlays?.[this.activeCameraId] ?? [];
    const [width, height] = size;
    this.ui.cameraStage.style.aspectRatio = `${width} / ${height}`;
    this.ui.cameraStage.style.width = `min(100%, calc((100vh - 190px) * ${width / height}))`;
    this.ui.cameraStage.style.height = 'auto';
    this.ui.cameraOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.ui.cameraOverlay.replaceChildren();
    overlays.forEach((box) => {
      const color = overlayPalette[box.label] ?? overlayPalette.unknown;
      const [x1, y1, x2, y2] = box.box;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x1);
      rect.setAttribute('y', y1);
      rect.setAttribute('width', Math.max(2, x2 - x1));
      rect.setAttribute('height', Math.max(2, y2 - y1));
      rect.style.stroke = color;
      rect.style.fill = `${color}22`;
      this.ui.cameraOverlay.appendChild(rect);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', Math.max(4, x1 + 4));
      label.setAttribute('y', Math.max(14, y1 - 5));
      label.style.fill = color;
      label.textContent = `${box.label} ${(box.confidence * 100).toFixed(0)}%`;
      this.ui.cameraOverlay.appendChild(label);
    });
  }

  playEgo() {
    this.perceptionSequenceMode = true;
    this.followEgo = true;
    this.setCameraBadge('third-person follow');
    this.ego?.play();
    this.syncPerceptionToPlayback();
    this.syncCameraFrame(true);
  }

  pauseEgo() {
    this.ego?.pause();
  }

  resetEgo() {
    this.perceptionSequenceMode = false;
    this.followEgo = false;
    this.setCameraBadge('orbit / pan / zoom');
    this.ego?.reset();
    this.updateScrubber();
    this.syncCameraFrame(true);
  }

  setEgoProgress(value) {
    this.perceptionSequenceMode = true;
    this.ego?.pause();
    this.ego?.setNormalizedTime(value);
    this.updateScrubber();
    this.syncPerceptionToPlayback();
    this.syncCameraFrame(true);
  }

  setEgoGoal() {
    this.followEgo = false;
    this.setCameraBadge('orbit / pan / zoom');
    this.ego?.setToEnd();
    this.updateScrubber();
    this.syncCameraFrame(true);
  }

  setCameraPreset(name, animated = true) {
    this.followEgo = false;
    this.setCameraBadge('orbit / pan / zoom');
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
    if (this.ui.cameraCount) {
      this.ui.cameraCount.textContent = `${metadata.exportedCameras ?? this.cameraManifest?.cameras?.length ?? 0}`;
    }
  }

  setDetail(message) {
    this.ui.detailStatus.textContent = message;
  }

  setLoading(message, isError = false) {
    this.ui.loadingStatus.textContent = message;
    this.ui.loadingStatus.classList.toggle('error', isError);
  }

  setCameraBadge(message) {
    if (this.ui.cameraBadge) {
      this.ui.cameraBadge.textContent = message;
    }
  }

  addBaseScene() {
    const ambient = new THREE.AmbientLight(0xb9c7d0, 1.45);
    const directional = new THREE.DirectionalLight(0xffffff, 1.8);
    directional.position.set(12, 24, 18);
    this.scene.add(ambient, directional);

    const grid = new THREE.GridHelper(280, 70, 0x6f7479, 0x2e343a);
    grid.position.set(-10, -0.02, -55);
    this.scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(290, 250),
      new THREE.MeshBasicMaterial({ color: 0x14191d, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-10, -0.04, -55);
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
      const speed = this.ego.playing || this.perceptionSequenceMode ? this.ego.currentSpeedKmh : 0;
      this.ui.speedValue.textContent = `${speed.toFixed(1)} km/h`;
    }
    if (this.ui.steerValue) {
      const steer = this.ego.playing ? Math.sin(time * 0.8) * 0.08 : 0;
      this.ui.steerValue.textContent = `${steer.toFixed(2)} rad`;
    }
  }

  updateFollowCamera() {
    if (!this.followEgo || !this.ego?.group) {
      return;
    }
    const vehicle = this.ego.group;
    const followOffset = new THREE.Vector3(-10.5, 5.0, 0).applyQuaternion(vehicle.quaternion);
    const targetOffset = new THREE.Vector3(4.0, 1.05, 0).applyQuaternion(vehicle.quaternion);
    const desiredPosition = vehicle.position.clone().add(followOffset);
    const desiredTarget = vehicle.position.clone().add(targetOffset);
    this.camera.position.lerp(desiredPosition, 0.14);
    this.controls.target.lerp(desiredTarget, 0.18);
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
    this.updateFollowCamera();
    this.controls.update();
    this.updateScrubber();
    this.syncPerceptionToPlayback();
    this.syncCameraFrame();
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
