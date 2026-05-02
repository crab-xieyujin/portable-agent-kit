from __future__ import annotations

import argparse
from pathlib import Path

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
}


def should_skip(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="List readable project files for platforms without native file search.")
    parser.add_argument("root", nargs="?", default=".", help="Project root")
    parser.add_argument("--contains", help="Only print files containing this text")
    parser.add_argument("--max-size", type=int, default=200_000, help="Maximum file size in bytes")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    for file in sorted(root.rglob("*")):
        if should_skip(file.relative_to(root)):
            continue
        if not file.is_file() or file.stat().st_size > args.max_size:
            continue
        if args.contains:
            try:
                text = file.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if args.contains not in text:
                continue
        print(file.relative_to(root).as_posix())


if __name__ == "__main__":
    main()
