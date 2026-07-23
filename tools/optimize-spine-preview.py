#!/usr/bin/env python3
"""Create a compact card-preview image from a Spine assembly reference."""

from __future__ import annotations

from pathlib import Path
import sys

from PIL import Image


MAX_SIZE = (512, 512)


def optimize(source: Path, output: Path) -> None:
    with Image.open(source) as image:
        image.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, "WEBP", quality=90, method=6, exact=True)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: optimize-spine-preview.py SOURCE OUTPUT", file=sys.stderr)
        return 2
    optimize(Path(sys.argv[1]), Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
