#!/usr/bin/env python3
"""Split a keyed 4x3 Spine parts sheet into trimmed RGBA attachments."""

from __future__ import annotations

import argparse
from collections import deque
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--names", required=True)
    parser.add_argument("--padding", type=int, default=8)
    parser.add_argument("--alpha-threshold", type=int, default=16)
    return parser.parse_args()


def connected_components(alpha: Image.Image, threshold: int) -> list[dict[str, object]]:
    width, height = alpha.size
    pixels = alpha.tobytes()
    visited = bytearray(width * height)
    components = []

    for start, value in enumerate(pixels):
        if value < threshold or visited[start]:
            continue
        queue = deque([start])
        visited[start] = 1
        count = 0
        min_x = max_x = start % width
        min_y = max_y = start // width
        while queue:
            current = queue.popleft()
            count += 1
            x = current % width
            y = current // width
            min_x = min(min_x, x)
            max_x = max(max_x, x)
            min_y = min(min_y, y)
            max_y = max(max_y, y)
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                row_offset = next_y * width
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row_offset + next_x
                    if not visited[neighbor] and pixels[neighbor] >= threshold:
                        visited[neighbor] = 1
                        queue.append(neighbor)
        if count >= 64:
            bbox = (min_x, min_y, max_x + 1, max_y + 1)
            components.append({
                "pixels": count,
                "bbox": bbox,
                "center": ((min_x + max_x + 1) / 2, (min_y + max_y + 1) / 2),
            })
    return components


def ordered_parts(alpha: Image.Image, threshold: int) -> list[dict[str, object]]:
    components = sorted(
        connected_components(alpha, threshold),
        key=lambda component: int(component["pixels"]),
        reverse=True,
    )
    if len(components) < 12:
        raise ValueError(f"Only {len(components)} foreground components were found; expected 12.")
    selected = sorted(components[:12], key=lambda component: float(component["center"][1]))
    rows = [selected[index:index + 4] for index in range(0, 12, 4)]
    return [
        component
        for row in rows
        for component in sorted(row, key=lambda current: float(current["center"][0]))
    ]


def split_sheet(
    source_path: Path,
    output_dir: Path,
    names: list[str],
    padding: int,
    alpha_threshold: int,
) -> dict[str, object]:
    if len(names) != 12 or len(set(names)) != 12:
        raise ValueError("A 4x3 sheet requires exactly 12 unique part names.")

    source = Image.open(source_path).convert("RGBA")
    output_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    components = ordered_parts(source.getchannel("A"), alpha_threshold)

    for index, (name, component) in enumerate(zip(names, components, strict=True)):
        bbox = component["bbox"]
        cropped = source.crop(bbox)
        attachment = Image.new(
            "RGBA",
            (cropped.width + padding * 2, cropped.height + padding * 2),
            (0, 0, 0, 0),
        )
        attachment.alpha_composite(cropped, (padding, padding))
        output_path = output_dir / f"{name}.png"
        attachment.save(output_path)
        parts.append({
            "name": name,
            "file": output_path.name,
            "cell": index,
            "sourceBounds": list(bbox),
            "opaquePixels": component["pixels"],
            "width": attachment.width,
            "height": attachment.height,
        })

    manifest = {
        "source": source_path.as_posix(),
        "sheetSize": [source.width, source.height],
        "layout": [4, 3],
        "padding": padding,
        "parts": parts,
    }
    (output_dir / "parts.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    args = parse_args()
    manifest = split_sheet(
        args.input,
        args.out_dir,
        [name.strip() for name in args.names.split(",") if name.strip()],
        args.padding,
        args.alpha_threshold,
    )
    print(f"Wrote {len(manifest['parts'])} Spine attachments to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
