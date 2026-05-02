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
    parser = argparse.ArgumentParser(description="Search text for platforms without ripgrep or native search.")
    parser.add_argument("query")
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--max-size", type=int, default=200_000)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    for file in sorted(root.rglob("*")):
        if should_skip(file.relative_to(root)):
            continue
        if not file.is_file() or file.stat().st_size > args.max_size:
            continue
        try:
            lines = file.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for index, line in enumerate(lines, start=1):
            if args.query in line:
                rel = file.relative_to(root).as_posix()
                print(f"{rel}:{index}: {line.strip()}")


if __name__ == "__main__":
    main()
