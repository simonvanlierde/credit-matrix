"""The run manifest: what a training or prediction run needs to be repeated and its energy checked.

Imports neither torch nor transformers, so it works (and is tested) without the `train` dependency group.
CodeCarbon is optional too: without it, or when it fails, the manifest says the energy was not tracked.
"""

import contextlib
import hashlib
import json
import os
import subprocess
import sys
from collections.abc import Generator, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PACKAGE = Path(__file__).resolve().parents[2]
"""The `census/` project directory, where `uv.lock` lives in a checkout."""

COUNTRY = "NLD"
"""Where the runs happen; CodeCarbon prices the energy with this country's annual grid intensity (Our World in Data)."""

SAMPLE_SECONDS = 1


def sha256(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PACKAGE, capture_output=True, text=True)
    except OSError:  # no git on this machine
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def base_model(repo: str, revision: str | None) -> dict[str, Any]:
    """The Hub repo and commit, with the SHA-256 of the downloaded weights (None when they are not in the cache)."""
    weights = None
    with contextlib.suppress(ImportError):
        from huggingface_hub import try_to_load_from_cache

        for name in ("model.safetensors", "pytorch_model.bin"):
            cached = try_to_load_from_cache(repo, name, revision=revision)
            if isinstance(cached, str):
                weights = sha256(Path(cached))
                break
    return {"repo": repo, "revision": revision, "weights_sha256": weights}


def _method(descriptions: Iterable[str]) -> dict[str, str | None]:
    """How CodeCarbon got each figure, read from its hardware descriptions: `CPU(Intel Rapl)` is read from the
    RAPL counters, any other CPU is an estimate from the chip's TDP and load. A GPU is read through NVML. The
    memory figure is always an estimate."""
    found = list(descriptions)
    cpu = next((d for d in found if d.startswith("CPU(")), "")
    return {
        "cpu_method": "rapl" if "Rapl" in cpu else "estimate",
        "gpu_method": "nvml" if any(d.startswith("GPU(") for d in found) else None,
        "ram_method": "estimate",
    }


@contextlib.contextmanager
def track_energy() -> Generator[dict[str, Any]]:
    """Measure the energy of the block with CodeCarbon in offline mode. The yielded dict is filled on exit:
    `{"tracked": False, "reason": ...}` when CodeCarbon is missing or fails, which never stops the run."""
    energy: dict[str, Any] = {"tracked": False, "reason": "not started"}
    tracker: Any = None
    try:
        from codecarbon import OfflineEmissionsTracker

        tracker = OfflineEmissionsTracker(
            country_iso_code=COUNTRY,
            measure_power_secs=SAMPLE_SECONDS,
            save_to_file=False,
            log_level="error",
        )
        tracker.start()
    except Exception as err:  # ImportError, or a sensor that cannot be opened
        tracker = None
        energy["reason"] = f"{type(err).__name__}: {err}"
    try:
        yield energy
    finally:
        if tracker is not None:
            try:
                tracker.stop()
                data = tracker.final_emissions_data
                energy.clear()
                energy.update(
                    tracked=True,
                    country=COUNTRY,
                    grid="Our World in Data annual average",
                    sample_seconds=SAMPLE_SECONDS,
                    **_method(tracker._conf.get("hardware", [])),
                    codecarbon=data.codecarbon_version,
                    kwh=data.energy_consumed,
                    cpu_kwh=data.cpu_energy,
                    gpu_kwh=data.gpu_energy,
                    ram_kwh=data.ram_energy,
                    co2e_kg=data.emissions,
                    seconds=data.duration,
                )
            except Exception as err:
                energy.clear()
                energy.update(tracked=False, reason=f"{type(err).__name__}: {err}")


def write(path: Path, kind: str, **sections: Any) -> Path:
    """Write `path` with the facts every run shares plus `sections`; returns `path`."""
    lock = PACKAGE / "uv.lock"
    manifest = {
        "kind": kind,
        "written": datetime.now(UTC).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "uv_lock_sha256": sha256(lock) if lock.exists() else None,
        # Set by the job script that starts the container, e.g. from `docker inspect`.
        "image_digest": os.environ.get("CENSUS_IMAGE_DIGEST"),
        "python": sys.version.split()[0],
        **sections,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return path
