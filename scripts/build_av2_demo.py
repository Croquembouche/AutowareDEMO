#!/usr/bin/env python3
import json
import math
import os
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image


LOG_ID = "02678d04-cc9f-3148-9f95-1ba66347dff9"
DEFAULT_AV2_ROOT = (
    "/run/user/1001/gvfs/smb-share:server=10.2.213.244,"
    "share=homes/publicDataset/Argoverse2"
)
MAX_POINT_COUNT = 18000
LIDAR_FRAME_STRIDE = 4
EGO_FRAME_STRIDE = 1
DEMO_PLAYBACK_TIME_SCALE = 2.0
RIGHT_LANE_VISUAL_OFFSET_M = 0.0
LANE_CROP_RADIUS_M = 105.0
POINT_CROP_RADIUS_M = 95.0
LIDAR_FRAME_MAX_POINTS = 900
CAMERA_MAX_WIDTH = 640
CAMERA_JPEG_QUALITY = 68
CAMERAS = [
    ("ring_front_center", "Front Center"),
    ("ring_front_left", "Front Left"),
    ("ring_front_right", "Front Right"),
    ("ring_side_left", "Side Left"),
    ("ring_side_right", "Side Right"),
    ("ring_rear_left", "Rear Left"),
    ("ring_rear_right", "Rear Right"),
    ("stereo_front_left", "Stereo Left"),
    ("stereo_front_right", "Stereo Right"),
]
LIDAR_RING_COLORS = np.array(
    [
        0x66CCFF,
        0x38BDF8,
        0x2DD4BF,
        0x7CFF6B,
        0xF9E44F,
        0xFFB454,
        0xFF6B8A,
        0xC084FC,
    ],
    dtype=np.uint32,
)

LABEL_MAP = {
    "REGULAR_VEHICLE": "vehicle",
    "VEHICLE": "vehicle",
    "BOX_TRUCK": "vehicle",
    "TRUCK": "vehicle",
    "BUS": "vehicle",
    "PEDESTRIAN": "pedestrian",
    "BICYCLIST": "cyclist",
    "MOTORCYCLIST": "cyclist",
}


def quat_to_matrix(qw, qx, qy, qz):
    return np.array(
        [
            [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
            [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
            [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
        ],
        dtype=np.float64,
    )


def quat_to_yaw(qw, qx, qy, qz):
    return math.atan2(2.0 * (qw * qz + qx * qy), 1.0 - 2.0 * (qy * qy + qz * qz))


def normalize_label(category):
    return LABEL_MAP.get(category, "unknown")


def box_corners_ego(ann):
    length, width, height = ann.length_m, ann.width_m, ann.height_m
    local = np.array(
        [[x, y, z] for x in (-length / 2, length / 2) for y in (-width / 2, width / 2) for z in (-height / 2, height / 2)],
        dtype=np.float64,
    )
    rotation = quat_to_matrix(ann.qw, ann.qx, ann.qy, ann.qz)
    center = np.array([ann.tx_m, ann.ty_m, ann.tz_m], dtype=np.float64)
    return (rotation @ local.T).T + center


def point_to_local(point, origin):
    return [
        round(point["x"] - origin[0], 3),
        round(point["y"] - origin[1], 3),
        round(point["z"] - origin[2], 3),
    ]


def row_pose(row):
    rotation = quat_to_matrix(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz)
    translation = np.array([row.pose_tx_m, row.pose_ty_m, row.pose_tz_m], dtype=np.float64)
    return rotation, translation


def min_distance_to_path_xy(points, path_xy):
    if not points:
        return float("inf")
    pts = np.array([[p["x"], p["y"]] for p in points], dtype=np.float64)
    deltas = pts[:, None, :] - path_xy[None, :, :]
    return float(np.sqrt(np.min(np.sum(deltas * deltas, axis=2))))


def centerline_from_boundaries(left, right):
    count = max(len(left), len(right))
    if count < 2:
        return []
    centerline = []
    for idx in range(count):
        li = round(idx * (len(left) - 1) / (count - 1))
        ri = round(idx * (len(right) - 1) / (count - 1))
        lp = left[li]
        rp = right[ri]
        centerline.append(
            {
                "x": (lp["x"] + rp["x"]) * 0.5,
                "y": (lp["y"] + rp["y"]) * 0.5,
                "z": (lp["z"] + rp["z"]) * 0.5,
            }
        )
    return centerline


def build_lanelet_json(map_data, origin, path_xy):
    lanelets = []
    for lane_id, segment in map_data["lane_segments"].items():
        left = segment.get("left_lane_boundary", [])
        right = segment.get("right_lane_boundary", [])
        center = centerline_from_boundaries(left, right)
        if min_distance_to_path_xy(left + right + center, path_xy) > LANE_CROP_RADIUS_M:
            continue
        lanelets.append(
            {
                "id": f"av2_lane_{lane_id}",
                "leftBoundary": [point_to_local(point, origin) for point in left],
                "rightBoundary": [point_to_local(point, origin) for point in right],
                "centerline": [point_to_local(point, origin) for point in center],
                "laneType": segment.get("lane_type", "VEHICLE"),
                "leftMarkType": segment.get("left_lane_mark_type", "UNKNOWN"),
                "rightMarkType": segment.get("right_lane_mark_type", "UNKNOWN"),
                "isIntersection": bool(segment.get("is_intersection", False)),
            }
        )

    crosswalks = []
    stop_lines = []
    for crossing_id, crossing in map_data["pedestrian_crossings"].items():
        polygon = crossing.get("edge1", []) + list(reversed(crossing.get("edge2", [])))
        if min_distance_to_path_xy(polygon, path_xy) > LANE_CROP_RADIUS_M:
            continue
        crosswalks.append(
            {
                "id": f"av2_crosswalk_{crossing_id}",
                "polygon": [point_to_local(point, origin) for point in polygon],
            }
        )
        if crossing.get("edge1"):
            stop_lines.append(
                {
                    "id": f"av2_stop_{crossing_id}",
                    "points": [point_to_local(point, origin) for point in crossing["edge1"]],
                }
            )

    return {
        "origin": {"x": origin[0], "y": origin[1], "z": origin[2]},
        "source": "Argoverse 2 sensor val",
        "logId": LOG_ID,
        "lanelets": lanelets,
        "crosswalks": crosswalks,
        "stopLines": stop_lines[:8],
        "trafficLights": [],
    }


def write_pcd(path, points):
    with open(path, "w", encoding="utf-8") as file:
        file.write("# .PCD v0.7 - Point Cloud Data file format\n")
        file.write("VERSION 0.7\n")
        file.write("FIELDS x y z rgb\n")
        file.write("SIZE 4 4 4 4\n")
        file.write("TYPE F F F U\n")
        file.write("COUNT 1 1 1 1\n")
        file.write(f"WIDTH {len(points)}\n")
        file.write("HEIGHT 1\n")
        file.write("VIEWPOINT 0 0 0 1 0 0 0\n")
        file.write(f"POINTS {len(points)}\n")
        file.write("DATA ascii\n")
        for point in points:
            file.write(f"{point[0]:.3f} {point[1]:.3f} {point[2]:.3f} {int(point[3])}\n")


def build_point_cloud(sync_df, dataset_root, origin, path_xy):
    chunks = []
    chosen = sync_df.iloc[::LIDAR_FRAME_STRIDE].copy()
    for row in chosen.itertuples():
        lidar_path = dataset_root / row.lidar_path
        lidar = pd.read_feather(lidar_path, columns=["x", "y", "z", "laser_number"])
        points = lidar[["x", "y", "z"]].to_numpy(dtype=np.float64)
        laser_numbers = lidar["laser_number"].to_numpy(dtype=np.uint8)
        keep = np.isfinite(points).all(axis=1)
        keep &= (points[:, 0] > -35) & (points[:, 0] < 70) & (np.abs(points[:, 1]) < 45)
        keep &= (points[:, 2] > -3.5) & (points[:, 2] < 5.0)
        points = points[keep]
        laser_numbers = laser_numbers[keep]
        if len(points) == 0:
            continue
        stride = max(1, len(points) // 1200)
        points = points[::stride]
        laser_numbers = laser_numbers[::stride]
        rotation, translation = row_pose(row)
        city = (rotation @ points.T).T + translation
        local = city - origin
        xy = city[:, :2]
        distances = np.sqrt(np.min(np.sum((xy[:, None, :] - path_xy[None, :, :]) ** 2, axis=2), axis=1))
        keep = distances < POINT_CROP_RADIUS_M
        local = local[keep]
        laser_numbers = laser_numbers[keep]
        colors = LIDAR_RING_COLORS[(laser_numbers // 8) % len(LIDAR_RING_COLORS)].astype(np.float64)
        chunks.append(np.column_stack([local, colors]))

    if not chunks:
        return np.empty((0, 3), dtype=np.float64)

    points = np.vstack(chunks)
    grid = np.round(points[:, :3] / np.array([0.45, 0.45, 0.18])).astype(np.int64)
    _, unique_idx = np.unique(grid, axis=0, return_index=True)
    points = points[np.sort(unique_idx)]
    if len(points) > MAX_POINT_COUNT:
        rng = np.random.default_rng(42)
        points = points[np.sort(rng.choice(len(points), MAX_POINT_COUNT, replace=False))]
    return points


def build_ego_indices(sync_df):
    indices = list(range(0, len(sync_df), EGO_FRAME_STRIDE))
    if indices[-1] != len(sync_df) - 1:
        indices.append(len(sync_df) - 1)
    return indices


def right_lane_offset_from_row(row):
    if RIGHT_LANE_VISUAL_OFFSET_M == 0.0:
        return np.zeros(2, dtype=np.float64)
    yaw = quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz)
    return np.array([math.sin(yaw), -math.cos(yaw)], dtype=np.float64) * RIGHT_LANE_VISUAL_OFFSET_M


def object_priority(center_ego, label, interior_points):
    forward = float(center_ego[0])
    lateral = abs(float(center_ego[1]))
    distance = math.hypot(float(center_ego[0]), float(center_ego[1]))
    in_forward_view = 0 if forward >= -8.0 else 1
    lane_relevance = 0 if lateral <= 14.0 else 1
    label_bonus = 0 if label == "vehicle" else 0.5
    confidence_bonus = min(float(interior_points), 80.0) / 160.0
    return (in_forward_view, lane_relevance, distance + label_bonus - confidence_bonus)


def build_ego_path(sync_df, origin, selected_indices):
    first_ts = int(sync_df.iloc[0].lidar_timestamp_ns)
    frames = []
    for demo_frame, sync_index in enumerate(selected_indices):
        row = sync_df.iloc[sync_index]
        source_t = (int(row.lidar_timestamp_ns) - first_ts) / 1e9
        yaw = quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz)
        right = right_lane_offset_from_row(row)
        source_position = [
            round(row.pose_tx_m - origin[0], 3),
            round(row.pose_ty_m - origin[1], 3),
            round(row.pose_tz_m - origin[2] + 0.34, 3),
        ]
        frames.append(
            {
                "demoFrame": demo_frame,
                "sourceFrameIndex": int(sync_index),
                "sourceT": round(source_t, 3),
                "t": round(source_t * DEMO_PLAYBACK_TIME_SCALE, 3),
                "sourcePosition": source_position,
                "position": [
                    round(source_position[0] + right[0], 3),
                    round(source_position[1] + right[1], 3),
                    source_position[2],
                ],
                "yaw": round(yaw, 5),
            }
        )
    return {"frames": frames}


def build_objects(sync_df, annotations, origin, selected_indices):
    out = []
    first_ts = int(sync_df.iloc[0].lidar_timestamp_ns)
    for frame_no, sync_index in enumerate(selected_indices):
        row = sync_df.iloc[sync_index]
        source_time = (int(row.lidar_timestamp_ns) - first_ts) / 1e9
        frame_time = source_time * DEMO_PLAYBACK_TIME_SCALE
        dynamic_offset = right_lane_offset_from_row(row)
        anns = annotations[annotations["timestamp_ns"] == row.lidar_timestamp_ns].copy()
        if anns.empty:
            out.append(
                {
                    "objects": [],
                    "sourceFrameIndex": int(sync_index),
                    "demoFrame": frame_no,
                    "sourceT": round(source_time, 3),
                    "t": round(frame_time, 3),
                }
            )
            continue
        rotation, translation = row_pose(row)
        objects = []
        for ann in anns.itertuples():
            center_ego = np.array([ann.tx_m, ann.ty_m, ann.tz_m], dtype=np.float64)
            center_city = rotation @ center_ego + translation
            center_local = center_city - origin
            center_visual = center_local.copy()
            center_visual[:2] += dynamic_offset
            ego_distance = math.hypot(center_ego[0], center_ego[1])
            if ego_distance > 90 or ann.num_interior_pts < 1:
                continue
            label = normalize_label(ann.category)
            yaw = quat_to_yaw(ann.qw, ann.qx, ann.qy, ann.qz) + quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz)
            confidence = min(0.99, 0.7 + ann.num_interior_pts / 80.0)
            objects.append(
                {
                    "id": f"av2_{ann.track_uuid[:8]}",
                    "label": label,
                    "sourcePosition": [round(center_local[0], 3), round(center_local[1], 3), round(center_local[2], 3)],
                    "position": [round(center_visual[0], 3), round(center_visual[1], 3), round(center_visual[2], 3)],
                    "size": [round(ann.length_m, 3), round(ann.width_m, 3), round(ann.height_m, 3)],
                    "yaw": round(yaw, 5),
                    "confidence": round(confidence, 2),
                    "egoFramePosition": [
                        round(float(center_ego[0]), 3),
                        round(float(center_ego[1]), 3),
                        round(float(center_ego[2]), 3),
                    ],
                    "priority": object_priority(center_ego, label, ann.num_interior_pts),
                }
            )
        objects.sort(key=lambda item: item["priority"])
        for item in objects:
            del item["priority"]
        out.append(
            {
                "objects": objects[:24],
                "sourceFrameIndex": int(sync_index),
                "demoFrame": frame_no,
                "sourceT": round(source_time, 3),
                "t": round(frame_time, 3),
            }
        )
    return out


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)
        file.write("\n")


def project_camera_boxes(annotations, camera_id, egovehicle_se3_sensor, intrinsics, scale):
    calibration = egovehicle_se3_sensor.loc[camera_id]
    intrinsic = intrinsics.loc[camera_id]
    rotation = quat_to_matrix(calibration.qw, calibration.qx, calibration.qy, calibration.qz)
    translation = np.array([calibration.tx_m, calibration.ty_m, calibration.tz_m], dtype=np.float64)
    boxes = []
    for ann in annotations.itertuples():
        if ann.num_interior_pts < 1:
            continue
        corners_camera = (rotation.T @ (box_corners_ego(ann) - translation).T).T
        valid = corners_camera[:, 2] > 0.2
        if not valid.any():
            continue
        projected = corners_camera[valid]
        u = intrinsic.fx_px * projected[:, 0] / projected[:, 2] + intrinsic.cx_px
        v = intrinsic.fy_px * projected[:, 1] / projected[:, 2] + intrinsic.cy_px
        x1, y1, x2, y2 = float(u.min()), float(v.min()), float(u.max()), float(v.max())
        if x2 < 0 or y2 < 0 or x1 > intrinsic.width_px or y1 > intrinsic.height_px:
            continue
        boxes.append(
            {
                "id": f"av2_{ann.track_uuid[:8]}",
                "label": normalize_label(ann.category),
                "box": [
                    round(max(0.0, x1 * scale), 1),
                    round(max(0.0, y1 * scale), 1),
                    round(min(float(intrinsic.width_px), x2) * scale, 1),
                    round(min(float(intrinsic.height_px), y2) * scale, 1),
                ],
                "confidence": round(min(0.99, 0.7 + ann.num_interior_pts / 80.0), 2),
            }
        )
    boxes.sort(key=lambda item: (item["box"][2] - item["box"][0]) * (item["box"][3] - item["box"][1]), reverse=True)
    return boxes[:16]


def export_camera_frames(sync_df, annotations, dataset_root, output_root, selected_indices, egovehicle_se3_sensor, intrinsics):
    camera_root = output_root / "public" / "demo" / "cameras"
    if camera_root.exists():
        shutil.rmtree(camera_root)
    camera_root.mkdir(parents=True, exist_ok=True)

    manifest = {"cameras": [], "frames": []}
    for camera_id, label in CAMERAS:
        manifest["cameras"].append({"id": camera_id, "label": label})
        (camera_root / camera_id).mkdir(parents=True, exist_ok=True)

    for demo_frame, sync_index in enumerate(selected_indices):
        row = sync_df.iloc[sync_index]
        frame_entry = {
            "demoFrame": demo_frame,
            "sourceFrameIndex": int(sync_index),
            "images": {},
            "sizes": {},
            "overlays": {},
        }
        frame_annotations = annotations[annotations["timestamp_ns"] == row.lidar_timestamp_ns].copy()
        for camera_id, _label in CAMERAS:
            source_path = dataset_root / row[f"{camera_id}_path"]
            output_rel = Path("demo") / "cameras" / camera_id / f"frame_{sync_index:03d}.jpg"
            output_path = output_root / "public" / output_rel
            with Image.open(source_path) as image:
                image = image.convert("RGB")
                scale = 1.0
                if image.width > CAMERA_MAX_WIDTH:
                    scale = CAMERA_MAX_WIDTH / image.width
                    next_height = round(image.height * CAMERA_MAX_WIDTH / image.width)
                    image = image.resize((CAMERA_MAX_WIDTH, next_height), Image.Resampling.LANCZOS)
                image.save(output_path, format="JPEG", quality=CAMERA_JPEG_QUALITY, optimize=True)
            frame_entry["images"][camera_id] = str(output_rel).replace(os.sep, "/")
            frame_entry["sizes"][camera_id] = [image.width, image.height]
            frame_entry["overlays"][camera_id] = project_camera_boxes(
                frame_annotations, camera_id, egovehicle_se3_sensor, intrinsics, scale
            )
        manifest["frames"].append(frame_entry)

    write_json(output_root / "public" / "demo" / "camera_manifest.json", manifest)
    return manifest


def export_lidar_frames(sync_df, annotations, dataset_root, output_root, selected_indices):
    rng = np.random.default_rng(7)
    frames = []
    for demo_frame, sync_index in enumerate(selected_indices):
        row = sync_df.iloc[sync_index]
        lidar_path = dataset_root / row.lidar_path
        lidar = pd.read_feather(lidar_path, columns=["x", "y", "z", "intensity", "laser_number"])
        points = lidar[["x", "y", "z"]].to_numpy(dtype=np.float64)
        intensity = lidar["intensity"].to_numpy(dtype=np.float64)
        laser_numbers = lidar["laser_number"].to_numpy(dtype=np.uint8)
        keep = np.isfinite(points).all(axis=1)
        keep &= (points[:, 0] > -35) & (points[:, 0] < 75) & (np.abs(points[:, 1]) < 40)
        keep &= (points[:, 2] > -3.0) & (points[:, 2] < 5.0)
        points = points[keep]
        intensity = intensity[keep]
        laser_numbers = laser_numbers[keep]
        if len(points) > LIDAR_FRAME_MAX_POINTS:
            chosen = np.sort(rng.choice(len(points), LIDAR_FRAME_MAX_POINTS, replace=False))
            points = points[chosen]
            intensity = intensity[chosen]
            laser_numbers = laser_numbers[chosen]
        colors = LIDAR_RING_COLORS[(laser_numbers // 8) % len(LIDAR_RING_COLORS)]
        frame_annotations = annotations[annotations["timestamp_ns"] == row.lidar_timestamp_ns].copy()
        boxes = []
        for ann in frame_annotations.itertuples():
            if ann.num_interior_pts < 1 or math.hypot(ann.tx_m, ann.ty_m) > 75:
                continue
            corners = box_corners_ego(ann)
            bottom = corners[np.argsort(corners[:, 2])[:4]][:, :2]
            center = np.array([ann.tx_m, ann.ty_m], dtype=np.float64)
            angles = np.arctan2(bottom[:, 1] - center[1], bottom[:, 0] - center[0])
            bottom = bottom[np.argsort(angles)]
            boxes.append(
                {
                    "id": f"av2_{ann.track_uuid[:8]}",
                    "label": normalize_label(ann.category),
                    "corners": [[round(float(x), 2), round(float(y), 2)] for x, y in bottom],
                    "confidence": round(min(0.99, 0.7 + ann.num_interior_pts / 80.0), 2),
                }
            )
        frames.append(
            {
                "demoFrame": demo_frame,
                "sourceFrameIndex": int(sync_index),
                "points": [
                    [
                        round(float(point[0]), 2),
                        round(float(point[1]), 2),
                        round(float(point[2]), 2),
                        int(color),
                        round(float(level) / 255.0, 2),
                    ]
                    for point, color, level in zip(points, colors, intensity)
                ],
                "boxes": boxes[:20],
            }
        )

    write_json(output_root / "public" / "demo" / "lidar_frames.json", {"frames": frames})
    return frames


def main():
    repo_root = Path(__file__).resolve().parents[1]
    av2_root = Path(os.environ.get("AV2_ROOT", DEFAULT_AV2_ROOT))
    dataset_root = av2_root
    log_root = dataset_root / "sensor" / "val" / LOG_ID
    sync_path = av2_root / "sync" / LOG_ID / "synchronized_frames_lidar_anchor.csv"
    map_path = log_root / "map" / f"log_map_archive_{LOG_ID}____PIT_city_71109.json"
    annotations_path = log_root / "annotations.feather"

    sync_df = pd.read_csv(sync_path)
    origin = np.array(
        [sync_df.iloc[0].pose_tx_m, sync_df.iloc[0].pose_ty_m, sync_df.iloc[0].pose_tz_m],
        dtype=np.float64,
    )
    path_xy = sync_df[["pose_tx_m", "pose_ty_m"]].to_numpy(dtype=np.float64)

    with open(map_path, encoding="utf-8") as file:
        map_data = json.load(file)

    lanelet_json = build_lanelet_json(map_data, origin, path_xy)
    ego_indices = build_ego_indices(sync_df)
    ego_path = build_ego_path(sync_df, origin, ego_indices)
    route = {"points": [frame["position"] for frame in ego_path["frames"][::3]]}
    if route["points"][-1] != ego_path["frames"][-1]["position"]:
        route["points"].append(ego_path["frames"][-1]["position"])

    annotations = pd.read_feather(annotations_path)
    egovehicle_se3_sensor = pd.read_feather(log_root / "calibration" / "egovehicle_SE3_sensor.feather").set_index("sensor_name")
    intrinsics = pd.read_feather(log_root / "calibration" / "intrinsics.feather").set_index("sensor_name")
    object_frames = build_objects(sync_df, annotations, origin, [0, len(sync_df) // 2, len(sync_df) - 1])
    object_sequence = build_objects(sync_df, annotations, origin, ego_indices)
    camera_manifest = export_camera_frames(sync_df, annotations, dataset_root, repo_root, ego_indices, egovehicle_se3_sensor, intrinsics)
    lidar_frames = export_lidar_frames(sync_df, annotations, dataset_root, repo_root, ego_indices)
    points = build_point_cloud(sync_df, dataset_root, origin, path_xy)

    write_json(repo_root / "public" / "maps" / "lanelet_demo.json", lanelet_json)
    write_json(repo_root / "public" / "demo" / "ego_path.json", ego_path)
    write_json(repo_root / "public" / "demo" / "route.json", route)
    for index, frame in enumerate(object_frames):
        write_json(repo_root / "public" / "demo" / f"objects_frame_{index:03d}.json", frame)
    write_json(repo_root / "public" / "demo" / "objects_sequence.json", {"frames": object_sequence})
    write_pcd(repo_root / "public" / "maps" / "pointcloud_map_small.pcd", points)
    write_json(
        repo_root / "public" / "demo" / "av2_metadata.json",
        {
            "source": "Argoverse 2 sensor val",
            "logId": LOG_ID,
            "syncFrames": int(len(sync_df)),
            "exportedLanelets": len(lanelet_json["lanelets"]),
            "exportedCrosswalks": len(lanelet_json["crosswalks"]),
            "exportedPointCount": int(len(points)),
            "exportedObjectSequenceFrames": len(object_sequence),
            "exportedCameraFrames": len(camera_manifest["frames"]),
            "exportedCameras": len(camera_manifest["cameras"]),
            "exportedLidarFrames": len(lidar_frames),
            "lidarFrameMaxPoints": LIDAR_FRAME_MAX_POINTS,
            "rightLaneVisualOffsetM": RIGHT_LANE_VISUAL_OFFSET_M,
            "lidarFrameStride": LIDAR_FRAME_STRIDE,
            "egoFrameStride": EGO_FRAME_STRIDE,
            "demoPlaybackTimeScale": DEMO_PLAYBACK_TIME_SCALE,
            "demoDurationSeconds": ego_path["frames"][-1]["t"],
            "maxPointCount": MAX_POINT_COUNT,
            "note": "Derived static browser demo assets; raw AV2 files are not committed.",
        },
    )

    print(f"Exported {len(points)} point cloud points")
    print(f"Exported {len(lanelet_json['lanelets'])} lanelets")
    print(f"Exported {len(ego_path['frames'])} ego poses")


if __name__ == "__main__":
    main()
