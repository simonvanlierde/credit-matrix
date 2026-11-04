"""Run tracking: what a training or prediction run needs to be repeated and its energy checked, recorded in MLflow.

Imports neither torch nor transformers, so it works (and is tested) without the `train` dependency group.
MLflow and CodeCarbon are optional too: without MLflow the run goes untracked and says so; without CodeCarbon
or when it fails, the energy is recorded as not tracked.
"""

import contextlib
import hashlib
import json
import os
import subprocess
import sys
from collections.abc import Generator, Iterable
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


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(["git", *args], cwd=PACKAGE, capture_output=True, text=True)
    except OSError:  # no git on this machine
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def git_commit() -> str | None:
    return _git("rev-parse", "HEAD")


def git_dirty() -> bool | None:
    """True when tracked files under census/ differ from the commit, so the commit alone does not repeat the run."""
    status = _git("status", "--porcelain", "--untracked-files=no", "--", ".")
    return None if status is None else bool(status)


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
        if tracker is not None:
            with contextlib.suppress(Exception):
                tracker.stop()
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
                    # CodeCarbon keeps the hardware list in a private dict; a missing one reads as an estimate.
                    **_method(getattr(tracker, "_conf", {}).get("hardware", [])),
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


class Tracker:
    """Writes to the open MLflow run; every method does nothing when MLflow is not installed."""

    def __init__(self, mlflow: Any = None):
        self._m = mlflow

    def params(self, params: dict[str, Any]) -> None:
        if self._m:
            self._m.log_params(params)

    def tags(self, tags: dict[str, Any]) -> None:
        if self._m:
            self._m.set_tags({k: v for k, v in tags.items() if v is not None})

    def metrics(self, metrics: dict[str, float], step: int | None = None) -> None:
        if self._m:
            self._m.log_metrics(metrics, step=step)

    def dataset(self, path: Path, context: str) -> None:
        """Log `path` as a run input. MLflow keeps 36 characters of a digest, so the full SHA-256 is a param too."""
        if not self._m:
            return
        from mlflow.entities import Dataset, DatasetInput, InputTag
        from mlflow.tracking import MlflowClient

        digest = sha256(path)
        dataset = Dataset(
            name=path.name,
            digest=digest[:36],
            source_type="local",
            source=json.dumps({"uri": path.resolve().as_uri()}),
        )
        MlflowClient().log_inputs(
            self._m.active_run().info.run_id,
            datasets=[DatasetInput(dataset, tags=[InputTag("mlflow.data.context", context)])],
        )
        self._m.log_param(f"sha256.{path.name}", digest)

    def epochs(self, log: Path) -> None:
        """The dev F1 at the best threshold and the elapsed seconds after each epoch of `log` (metrics.jsonl)."""
        self.epochs_from(epoch_points(log.read_text(encoding="utf-8").splitlines()))

    def epochs_from(self, points: list[tuple[dict[str, float], int]]) -> None:
        for metrics, step in points:
            self.metrics(metrics, step=step)

    def energy(self, energy: dict[str, Any]) -> None:
        """kWh by component as metrics; how each figure was got, and why not, as tags."""
        tracked = energy.get("tracked")
        self.tags({"energy_tracked": tracked, "energy_reason": energy.get("reason")})
        if not tracked:
            return
        self.tags({f"energy_{k}": energy[k] for k in ("cpu_method", "gpu_method", "ram_method", "country", "grid")})
        self.metrics(
            {
                f"energy_{k}": energy[k]
                for k in ("kwh", "cpu_kwh", "gpu_kwh", "ram_kwh", "co2e_kg", "seconds")
                if energy[k] is not None
            }
        )


def epoch_points(lines: list[str]) -> list[tuple[dict[str, float], int]]:
    """(metrics, epoch) for each epoch line of a metrics.jsonl; raises on a line that is not valid."""
    points = []
    for line in lines:
        record = json.loads(line)
        if "epoch" in record:
            f1 = max(row["f1"] for row in record["dev"].values())
            points.append(({"dev_f1": f1, "seconds": record["seconds"]}, record["epoch"]))
    return points


@contextlib.contextmanager
def tracking(
    db: Path, experiment: str, name: str, kind: str, current: bool = True, start_time: int | None = None
) -> Generator[Tracker]:
    """Open an MLflow run `name` in `experiment`, tagged with the facts every run shares. The store is
    MLFLOW_TRACKING_URI, else the SQLite file `db`. An exception in the block marks the run failed.
    `current=False` leaves out the facts about this checkout, for a run that happened earlier, and
    `start_time` (epoch milliseconds) says when it started. A train run is tagged `run_dir` with its
    name, which is its directory name, so `backfill` knows it is already there."""
    try:
        import mlflow
    except ImportError:
        print("MLflow is not installed; tracking skipped (`uv sync --group tracking` adds it)")
        yield Tracker()
        return
    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI") or f"sqlite:///{db}")
    mlflow.set_experiment(experiment)
    lock = PACKAGE / "uv.lock"
    # start_run cannot set a start time; a run created with one and then resumed keeps it.
    run_id = None
    if start_time is not None:
        exp = mlflow.set_experiment(experiment)
        run_id = mlflow.MlflowClient().create_run(exp.experiment_id, start_time, run_name=name).info.run_id
    with mlflow.start_run(run_id=run_id, run_name=None if run_id else name):
        tracker = Tracker(mlflow)
        tracker.tags({"kind": kind, "run_dir": name if kind == "train" else None})
        if current:
            tracker.tags(
                {
                    "mlflow.source.git.commit": git_commit(),
                    "git_dirty": git_dirty(),
                    "uv_lock_sha256": sha256(lock) if lock.exists() else None,
                    # Set by the job script that starts the container, e.g. from `docker inspect`.
                    "image_digest": os.environ.get("CENSUS_IMAGE_DIGEST"),
                }
            )
        yield tracker


def _read_run(run: Path) -> tuple[dict[str, Any], dict[str, Any], list, bool, dict[str, Any] | None, int]:
    """Parse a run directory fully: (config, manifest, epoch points, finished, start ms). Raises on bad files."""
    config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    log = run / "metrics.jsonl"
    lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    first = json.loads(lines[0]) if lines else {}
    manifest = {} if "step" in first or "epoch" in first else first
    points = epoch_points(lines)
    best_file = run / "best.json"
    best = json.loads(best_file.read_text(encoding="utf-8")) if best_file.exists() else None
    # best.json appears after the first improving epoch, so only the epoch count says the run ended.
    finished = len(points) >= config["epochs"]
    start = min(f.stat().st_mtime for f in run.iterdir() if f.is_file())
    return config, manifest, points, finished, best, int(start * 1000)


def backfill(db: Path, experiment: str, runs: Path) -> tuple[int, int]:
    """Record every training run directory under `runs` that the store does not hold yet, and return
    (added, already there). A run is told apart by its directory name, the tag `run_dir`. Each holds
    `config.json` (params), `metrics.jsonl` (a manifest line, then loss and per-epoch dev scores) and
    `best.json` (the best epoch's scores). A run is `finished` when it logged all `epochs` epochs.
    A directory that cannot be parsed is reported on stderr and left out, to be retried next time."""
    try:
        import mlflow
    except ImportError:
        raise RuntimeError("MLflow is not installed; `uv sync --group tracking` adds it") from None
    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI") or f"sqlite:///{db}")
    exp = mlflow.set_experiment(experiment)
    known = {
        r.data.tags["run_dir"]
        for r in mlflow.MlflowClient().search_runs([exp.experiment_id], max_results=50_000)
        if "run_dir" in r.data.tags and r.info.status == "FINISHED"
    }
    added = 0
    for run in sorted(p for p in runs.iterdir() if (p / "config.json").exists()):
        if run.name in known:
            continue
        try:
            config, manifest, points, finished, best, start = _read_run(run)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            print(f"skipped {run.name}: {type(error).__name__}: {error}", file=sys.stderr)
            continue
        with tracking(db, experiment, run.name, "train", current=False, start_time=start) as t:
            t.params({f"config.{k}": v for k, v in config.items()})
            t.tags(
                {
                    "backfilled": True,
                    "finished": finished,
                    "mlflow.source.git.commit": manifest.get("git_commit"),
                    **{f"manifest.{k}": v for k, v in manifest.items() if k != "git_commit"},
                }
            )
            t.epochs_from(points)
            if best:
                t.metrics({f"best_{k}": v for k, v in best.items()})
        added += 1
    return added, len(known)
