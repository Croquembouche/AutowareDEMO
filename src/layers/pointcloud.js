import * as THREE from 'three';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { toWorld } from '../utils/coordinates.js';

export function loadPointCloud(url) {
  const loader = new PCDLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (points) => {
        points.name = 'Point Cloud Map';
        const hasVertexColors = Boolean(points.geometry.getAttribute('color'));
        points.material = new THREE.PointsMaterial({
          size: 0.3,
          color: 0xd8eef7,
          transparent: true,
          opacity: 0.94,
          depthWrite: false,
          sizeAttenuation: true,
          vertexColors: hasVertexColors
        });

        const source = points.geometry.getAttribute('position');
        const converted = new Float32Array(source.count * 3);
        for (let index = 0; index < source.count; index += 1) {
          const mapped = toWorld([source.getX(index), source.getY(index), source.getZ(index)]);
          converted[index * 3] = mapped.x;
          converted[index * 3 + 1] = mapped.y;
          converted[index * 3 + 2] = mapped.z;
        }
        points.geometry.setAttribute('position', new THREE.BufferAttribute(converted, 3));
        points.geometry.computeBoundingSphere();

        const group = new THREE.Group();
        group.name = 'Point Cloud Map';
        group.add(points);
        resolve(group);
      },
      undefined,
      (error) => reject(new Error(`Point cloud failed to load: ${error.message || url}`))
    );
  });
}
