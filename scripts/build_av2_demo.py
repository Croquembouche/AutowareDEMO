#!/usr/bin/env python3
import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd


LOG_ID = "02678d04-cc9f-3148-9f95-1ba66347dff9"
DEFAULT_AV2_ROOT = (
    "/run/user/1001/gvfs/smb-share:server=10.2.213.244,"
    "share=homes/publicDataset/Argoverse2"
)
MAX_POINT_COUNT = 18000
LIDAR_FRAME_STRIDE = 4
OBJECT_SEQUENCE_FRAME_COUNT = 24
LANE_CROP_RADIUS_M = 105.0
POINT_CROP_RADIUS_M = 95.0


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
        file.write("FIELDS x y z\n")
        file.write("SIZE 4 4 4\n")
        file.write("TYPE F F F\n")
        file.write("COUNT 1 1 1\n")
        file.write(f"WIDTH {len(points)}\n")
        file.write("HEIGHT 1\n")
        file.write("VIEWPOINT 0 0 0 1 0 0 0\n")
        file.write(f"POINTS {len(points)}\n")
        file.write("DATA ascii\n")
        for point in points:
            file.write(f"{point[0]:.3f} {point[1]:.3f} {point[2]:.3f}\n")


def build_point_cloud(sync_df, dataset_root, origin, path_xy):
    chunks = []
    chosen = sync_df.iloc[::LIDAR_FRAME_STRIDE].copy()
    for row in chosen.itertuples():
        lidar_path = dataset_root / row.lidar_path
        lidar = pd.read_feather(lidar_path, columns=["x", "y", "z"])
        points = lidar.to_numpy(dtype=np.float64)
        points = points[np.isfinite(points).all(axis=1)]
        points = points[(points[:, 0] > -35) & (points[:, 0] < 70) & (np.abs(points[:, 1]) < 45)]
        points = points[(points[:, 2] > -3.5) & (points[:, 2] < 5.0)]
        if len(points) == 0:
            continue
        points = points[:: max(1, len(points) // 1200)]
        rotation, translation = row_pose(row)
        city = (rotation @ points.T).T + translation
        local = city - origin
        xy = city[:, :2]
        distances = np.sqrt(np.min(np.sum((xy[:, None, :] - path_xy[None, :, :]) ** 2, axis=2), axis=1))
        local = local[distances < POINT_CROP_RADIUS_M]
        chunks.append(local)

    if not chunks:
        return np.empty((0, 3), dtype=np.float64)

    points = np.vstack(chunks)
    grid = np.round(points / np.array([0.45, 0.45, 0.18])).astype(np.int64)
    _, unique_idx = np.unique(grid, axis=0, return_index=True)
    points = points[np.sort(unique_idx)]
    if len(points) > MAX_POINT_COUNT:
        rng = np.random.default_rng(42)
        points = points[np.sort(rng.choice(len(points), MAX_POINT_COUNT, replace=False))]
    return points


def build_ego_path(sync_df, origin):
    first_ts = int(sync_df.iloc[0].lidar_timestamp_ns)
    frames = []
    for row in sync_df.iloc[::4].itertuples():
        t = (int(row.lidar_timestamp_ns) - first_ts) / 1e9
        frames.append(
            {
                "t": round(t, 3),
                "position": [
                    round(row.pose_tx_m - origin[0], 3),
                    round(row.pose_ty_m - origin[1], 3),
                    round(row.pose_tz_m - origin[2] + 0.34, 3),
                ],
                "yaw": round(quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz), 5),
            }
        )
    if frames[-1]["t"] < (int(sync_df.iloc[-1].lidar_timestamp_ns) - first_ts) / 1e9:
        row = sync_df.iloc[-1]
        frames.append(
            {
                "t": round((int(row.lidar_timestamp_ns) - first_ts) / 1e9, 3),
                "position": [
                    round(row.pose_tx_m - origin[0], 3),
                    round(row.pose_ty_m - origin[1], 3),
                    round(row.pose_tz_m - origin[2] + 0.34, 3),
                ],
                "yaw": round(quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz), 5),
            }
        )
    return {"frames": frames}


def build_objects(sync_df, annotations, origin, selected_indices):
    out = []
    first_ts = int(sync_df.iloc[0].lidar_timestamp_ns)
    label_map = {
        "REGULAR_VEHICLE": "vehicle",
        "VEHICLE": "vehicle",
        "BOX_TRUCK": "vehicle",
        "TRUCK": "vehicle",
        "BUS": "vehicle",
        "PEDESTRIAN": "pedestrian",
        "BICYCLIST": "cyclist",
        "MOTORCYCLIST": "cyclist",
    }
    for frame_no, sync_index in enumerate(selected_indices):
        row = sync_df.iloc[sync_index]
        frame_time = (int(row.lidar_timestamp_ns) - first_ts) / 1e9
        anns = annotations[annotations["timestamp_ns"] == row.lidar_timestamp_ns].copy()
        if anns.empty:
            out.append({"objects": [], "sourceFrameIndex": int(sync_index), "demoFrame": frame_no, "t": round(frame_time, 3)})
            continue
        rotation, translation = row_pose(row)
        objects = []
        for ann in anns.itertuples():
            center_ego = np.array([ann.tx_m, ann.ty_m, ann.tz_m], dtype=np.float64)
            center_city = rotation @ center_ego + translation
            center_local = center_city - origin
            distance = math.hypot(center_local[0], center_local[1])
            if distance > 80 or ann.num_interior_pts < 1:
                continue
            label = label_map.get(ann.category, "unknown")
            yaw = quat_to_yaw(ann.qw, ann.qx, ann.qy, ann.qz) + quat_to_yaw(row.pose_qw, row.pose_qx, row.pose_qy, row.pose_qz)
            confidence = min(0.99, 0.7 + ann.num_interior_pts / 80.0)
            objects.append(
                {
                    "id": f"av2_{ann.track_uuid[:8]}",
                    "label": label,
                    "position": [round(center_local[0], 3), round(center_local[1], 3), round(center_local[2], 3)],
                    "size": [round(ann.length_m, 3), round(ann.width_m, 3), round(ann.height_m, 3)],
                    "yaw": round(yaw, 5),
                    "confidence": round(confidence, 2),
                }
            )
        objects.sort(key=lambda item: math.hypot(item["position"][0], item["position"][1]))
        out.append({"objects": objects[:12], "sourceFrameIndex": int(sync_index), "demoFrame": frame_no, "t": round(frame_time, 3)})
    return out


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)
        file.write("\n")


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
    ego_path = build_ego_path(sync_df, origin)
    route = {"points": [frame["position"] for frame in ego_path["frames"][::3]]}
    if route["points"][-1] != ego_path["frames"][-1]["position"]:
        route["points"].append(ego_path["frames"][-1]["position"])

    annotations = pd.read_feather(annotations_path)
    object_frames = build_objects(sync_df, annotations, origin, [0, len(sync_df) // 2, len(sync_df) - 1])
    sequence_indices = np.linspace(0, len(sync_df) - 1, OBJECT_SEQUENCE_FRAME_COUNT, dtype=int).tolist()
    object_sequence = build_objects(sync_df, annotations, origin, sequence_indices)
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
            "lidarFrameStride": LIDAR_FRAME_STRIDE,
            "maxPointCount": MAX_POINT_COUNT,
            "note": "Derived static browser demo assets; raw AV2 files are not committed.",
        },
    )

    print(f"Exported {len(points)} point cloud points")
    print(f"Exported {len(lanelet_json['lanelets'])} lanelets")
    print(f"Exported {len(ego_path['frames'])} ego poses")


if __name__ == "__main__":
    main()
