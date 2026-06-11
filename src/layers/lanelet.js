import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { makeLineGeometry, toWorld, toWorldArray } from '../utils/coordinates.js';

const materials = {
  boundary: new THREE.LineBasicMaterial({ color: 0x2be7ff, transparent: true, opacity: 0.95 }),
  centerline: new THREE.LineDashedMaterial({ color: 0xf9e44f, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9 }),
  crosswalk: new THREE.MeshBasicMaterial({ color: 0xf0f5f7, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  crosswalkLine: new THREE.LineBasicMaterial({ color: 0xf0f5f7, transparent: true, opacity: 0.75 }),
  stopLine: new THREE.LineBasicMaterial({ color: 0xff4d64, transparent: true, opacity: 1 }),
  signalRed: new THREE.MeshBasicMaterial({ color: 0xff354f }),
  signalGreen: new THREE.MeshBasicMaterial({ color: 0x39d98a }),
  signalYellow: new THREE.MeshBasicMaterial({ color: 0xffc857 })
};

export function createLaneletLayers(data) {
  const laneBoundaries = new THREE.Group();
  const centerlines = new THREE.Group();
  const crosswalks = new THREE.Group();
  const stopLines = new THREE.Group();
  const trafficLights = new THREE.Group();

  laneBoundaries.name = 'Lanelet Boundaries';
  centerlines.name = 'Centerlines';
  crosswalks.name = 'Crosswalks';
  stopLines.name = 'Stop Lines';
  trafficLights.name = 'Traffic Lights';

  data.lanelets.forEach((lanelet) => {
    const left = new THREE.Line(makeLineGeometry(lanelet.leftBoundary), materials.boundary);
    const right = new THREE.Line(makeLineGeometry(lanelet.rightBoundary), materials.boundary);
    left.name = `${lanelet.id} left boundary`;
    right.name = `${lanelet.id} right boundary`;
    laneBoundaries.add(left, right);

    const center = new THREE.Line(makeLineGeometry(lanelet.centerline), materials.centerline);
    center.computeLineDistances();
    center.name = `${lanelet.id} centerline`;
    centerlines.add(center);
  });

  data.crosswalks.forEach((crosswalk) => {
    const shape = new THREE.Shape();
    const points = toWorldArray(crosswalk.polygon);
    shape.moveTo(points[0].x, points[0].z);
    points.slice(1).forEach((point) => shape.lineTo(point.x, point.z));
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, materials.crosswalk);
    mesh.position.y = 0.035;
    mesh.name = crosswalk.id;

    const outlinePoints = [...crosswalk.polygon, crosswalk.polygon[0]];
    const outline = new THREE.Line(makeLineGeometry(outlinePoints), materials.crosswalkLine);
    outline.position.y = 0.045;
    crosswalks.add(mesh, outline);
  });

  data.stopLines.forEach((stopLine) => {
    const line = new THREE.Line(makeLineGeometry(stopLine.points), materials.stopLine);
    line.position.y = 0.06;
    line.name = stopLine.id;
    stopLines.add(line);
  });

  data.trafficLights.forEach((trafficLight) => {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 3.0, 10),
      new THREE.MeshBasicMaterial({ color: 0x6f8490 })
    );
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.8, 0.18),
      new THREE.MeshBasicMaterial({ color: 0x202b31 })
    );
    const lampMaterial = trafficLight.state === 'green'
      ? materials.signalGreen
      : trafficLight.state === 'yellow'
        ? materials.signalYellow
        : materials.signalRed;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), lampMaterial);

    const group = new THREE.Group();
    group.name = trafficLight.id;
    group.position.copy(toWorld(trafficLight.position));
    mast.position.y = -1.5;
    head.position.set(0, 0.1, 0);
    lamp.position.set(0, 0.1, -0.1);
    group.add(mast, head, lamp);

    const label = makeLabel(trafficLight.state.toUpperCase(), 'map-label signal-label');
    label.position.set(0, 0.72, 0);
    group.add(label);
    trafficLights.add(group);
  });

  return { laneBoundaries, centerlines, crosswalks, stopLines, trafficLights };
}

function makeLabel(text, className) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return new CSS2DObject(element);
}
