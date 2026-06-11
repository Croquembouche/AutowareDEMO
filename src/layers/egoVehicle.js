import * as THREE from 'three';
import { applyMapPose, interpolatePose, makeLineGeometry } from '../utils/coordinates.js';

export class EgoVehicleLayer {
  constructor(pathData) {
    this.pathData = pathData;
    this.duration = pathData.frames[pathData.frames.length - 1]?.t ?? 1;
    this.normalizedTime = 0;
    this.playing = false;
    this.group = createVehicleModel();
    this.trailGroup = createTrail(pathData);
    this.currentPose = null;
    this.currentFrameIndex = 0;
    this.currentSourceFrameIndex = pathData.frames[0]?.sourceFrameIndex ?? 0;
    this.setNormalizedTime(0);
  }

  play() {
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  reset() {
    this.playing = false;
    this.setNormalizedTime(0);
  }

  setNormalizedTime(value) {
    this.normalizedTime = THREE.MathUtils.clamp(value, 0, 1);
    this.currentFrameIndex = findNearestFrameIndex(this.pathData.frames, this.normalizedTime);
    this.currentSourceFrameIndex = this.pathData.frames[this.currentFrameIndex]?.sourceFrameIndex ?? this.currentFrameIndex;
    const pose = interpolatePose(this.pathData.frames, this.normalizedTime);
    if (pose) {
      this.currentPose = pose;
      applyMapPose(this.group, pose.position, pose.yaw);
    }
  }

  setToEnd() {
    this.playing = false;
    this.setNormalizedTime(1);
  }

  update(deltaSeconds) {
    if (!this.playing) {
      return;
    }
    const next = this.normalizedTime + deltaSeconds / this.duration;
    this.setNormalizedTime(next);
    if (this.normalizedTime >= 1) {
      this.playing = false;
    }
  }
}

function findNearestFrameIndex(frames, normalizedTime) {
  if (!frames.length) {
    return 0;
  }

  const duration = frames[frames.length - 1].t || 1;
  const targetTime = THREE.MathUtils.clamp(normalizedTime, 0, 1) * duration;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  frames.forEach((frame, index) => {
    const distance = Math.abs(frame.t - targetTime);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });
  return nearestIndex;
}

function createVehicleModel() {
  const group = new THREE.Group();
  group.name = 'Ego Vehicle';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.9, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.42, metalness: 0.2 })
  );
  body.position.y = 0.55;

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.55, 1.25),
    new THREE.MeshStandardMaterial({ color: 0xbbe8ff, roughness: 0.3, metalness: 0.15, transparent: true, opacity: 0.82 })
  );
  cabin.position.set(0.15, 1.2, 0);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.9, 3),
    new THREE.MeshBasicMaterial({ color: 0x28ff8a })
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(2.2, 0.62, 0);

  const wheelMaterial = new THREE.MeshBasicMaterial({ color: 0x111820 });
  const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16);
  const wheelOffsets = [
    [-1.25, 0.25, -0.96],
    [1.25, 0.25, -0.96],
    [-1.25, 0.25, 0.96],
    [1.25, 0.25, 0.96]
  ];
  const wheels = wheelOffsets.map((offset) => {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(...offset);
    return wheel;
  });

  group.add(body, cabin, nose, ...wheels);
  return group;
}

function createTrail(pathData) {
  const group = new THREE.Group();
  group.name = 'Trajectory Trail';
  const line = new THREE.Line(
    makeLineGeometry(pathData.frames.map((frame) => frame.position)),
    new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.6, gapSize: 0.45, transparent: true, opacity: 0.85 })
  );
  line.computeLineDistances();
  line.position.y = 0.1;
  group.add(line);
  return group;
}
