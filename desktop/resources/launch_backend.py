from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def ensure_path(path: Path) -> None:
    resolved = path.resolve()
    path_text = str(resolved)
    if resolved.exists() and path_text not in sys.path:
        sys.path.insert(0, path_text)


def main() -> None:
    resource_dir = Path(__file__).resolve().parent
    backend_dir = resource_dir / "backend"
    dependency_dir = resource_dir / "backend-deps"
    backend_entry = backend_dir / "backend.py"

    if not backend_entry.exists():
        raise FileNotFoundError(f"backend.py not found: {backend_entry}")

    ensure_path(dependency_dir)
    ensure_path(backend_dir)

    os.chdir(backend_dir)
    runpy.run_path(str(backend_entry), run_name="__main__")


if __name__ == "__main__":
    main()
