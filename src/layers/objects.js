import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { applyMapPose } from '../utils/coordinates.js';

const palette = {
  vehicle: 0xffa23a,
  pedestrian: 0xff4d88,
  cyclist: 0xb7ff3d,
  unknown: 0xc7d2fe
};

export function createObjectsLayer(frameData) {
  const group = new THREE.Group();
  group.name = 'Perception Objects';
  updateObjectsLayer(group, frameData);
  return group;
}

export function updateObjectsLayer(group, frameData) {
  group.traverse((child) => {
    if (child.element?.parentNode) {
      child.element.remove();
    }
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
  group.clear();
  frameData.objects.forEach((object) => {
    const color = palette[object.label] ?? palette.unknown;
    const wrapper = new THREE.Group();
    wrapper.name = `${object.label} ${object.id}`;
    applyMapPose(wrapper, object.position, object.yaw);

    const geometry = new THREE.BoxGeometry(object.size[0], object.size[2], object.size[1]);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    });
    const box = new THREE.Mesh(geometry, material);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.98 })
    );

    const label = makeObjectLabel(object, color);
    label.position.set(0, object.size[2] / 2 + 0.35, 0);
    wrapper.add(box, edges, label);
    group.add(wrapper);
  });
}

function makeObjectLabel(object, color) {
  const element = document.createElement('div');
  element.className = 'map-label object-label';
  element.style.borderColor = `#${color.toString(16).padStart(6, '0')}`;
  element.textContent = `${object.label} ${(object.confidence * 100).toFixed(0)}%`;
  return new CSS2DObject(element);
}
