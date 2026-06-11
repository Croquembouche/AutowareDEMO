import * as THREE from 'three';
import { makeLineGeometry, toWorld } from '../utils/coordinates.js';

export function createRouteLayer(routeData) {
  const group = new THREE.Group();
  group.name = 'Route';

  const route = new THREE.Line(
    makeLineGeometry(routeData.points),
    new THREE.LineBasicMaterial({ color: 0x28ff8a, transparent: true, opacity: 1 })
  );
  route.position.y = 0.12;
  route.name = 'Fixed Route';
  group.add(route);

  routeData.points.forEach((point, index) => {
    if (index === 0 || index === routeData.points.length - 1) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(index === 0 ? 0.32 : 0.44, index === 0 ? 0.32 : 0.44, 0.08, 24),
        new THREE.MeshBasicMaterial({ color: index === 0 ? 0x38bdf8 : 0x28ff8a, transparent: true, opacity: 0.92 })
      );
      marker.position.copy(toWorld([point[0], point[1], point[2] + 0.12]));
      marker.name = index === 0 ? 'Start Marker' : 'Goal Marker';
      group.add(marker);
    }
  });

  return group;
}

export function createPredictedPathLayer(pathData) {
  const group = new THREE.Group();
  group.name = 'Predicted Path';
  const material = new THREE.LineDashedMaterial({ color: 0x9d7cff, dashSize: 0.85, gapSize: 0.45, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(makeLineGeometry(pathData.frames.map((frame) => frame.position)), material);
  line.computeLineDistances();
  line.position.y = 0.1;
  group.add(line);
  return group;
}
