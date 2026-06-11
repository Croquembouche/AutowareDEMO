import * as THREE from 'three';

export function toWorld(point) {
  return new THREE.Vector3(point[0], point[2] ?? 0, point[1]);
}

export function toWorldArray(points) {
  return points.map((point) => toWorld(point));
}

export function applyMapPose(object, position, yaw = 0) {
  object.position.copy(toWorld(position));
  object.rotation.set(0, -yaw, 0);
}

export function makeLineGeometry(points) {
  return new THREE.BufferGeometry().setFromPoints(toWorldArray(points));
}

export function interpolatePose(frames, normalizedTime) {
  if (!frames.length) {
    return null;
  }

  const duration = frames[frames.length - 1].t;
  const t = THREE.MathUtils.clamp(normalizedTime, 0, 1) * duration;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (t >= current.t && t <= next.t) {
      const span = Math.max(next.t - current.t, 0.0001);
      const alpha = (t - current.t) / span;
      return {
        t,
        position: [
          THREE.MathUtils.lerp(current.position[0], next.position[0], alpha),
          THREE.MathUtils.lerp(current.position[1], next.position[1], alpha),
          THREE.MathUtils.lerp(current.position[2], next.position[2], alpha)
        ],
        yaw: THREE.MathUtils.lerp(current.yaw, next.yaw, alpha)
      };
    }
  }

  return frames[frames.length - 1];
}
