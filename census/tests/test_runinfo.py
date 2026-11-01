import hashlib
import json
import sys
import types

import pytest

from census import runinfo


def test_sha256_matches_hashlib(tmp_path):
    f = tmp_path / "train.jsonl"
    f.write_bytes(b"abc\n")
    assert runinfo.sha256(f) == hashlib.sha256(b"abc\n").hexdigest()


def test_energy_says_untracked_when_codecarbon_is_missing(monkeypatch):
    monkeypatch.setitem(sys.modules, "codecarbon", None)
    with runinfo.track_energy() as energy:
        pass
    assert energy["tracked"] is False and "codecarbon" in energy["reason"]


def _fake_codecarbon(monkeypatch, hardware):
    seen: dict = {}

    class Tracker:
        final_emissions_data = types.SimpleNamespace(
            codecarbon_version="3.3.2",
            energy_consumed=0.5,
            cpu_energy=0.1,
            gpu_energy=0.3,
            ram_energy=0.1,
            emissions=0.2,
            duration=12.0,
        )
        _conf = {"hardware": hardware}  # noqa: RUF012

        def __init__(self, **kwargs):
            seen.update(kwargs)

        def start(self): ...
        def stop(self): ...

    monkeypatch.setitem(sys.modules, "codecarbon", types.SimpleNamespace(OfflineEmissionsTracker=Tracker))
    return seen


def test_energy_flags_a_tdp_estimate_for_the_cpu(monkeypatch):
    seen = _fake_codecarbon(monkeypatch, ["RAM()", "GPU() (NVIDIA GeForce RTX 4090)", "CPU(Cpu Load)"])
    with runinfo.track_energy() as energy:
        pass
    assert seen["country_iso_code"] == "NLD" and seen["measure_power_secs"] >= 1
    assert energy["tracked"] and energy["kwh"] == 0.5 and energy["co2e_kg"] == 0.2
    assert (energy["cpu_method"], energy["gpu_method"], energy["ram_method"]) == ("estimate", "nvml", "estimate")


def test_energy_flags_rapl_when_codecarbon_reads_it(monkeypatch):
    _fake_codecarbon(monkeypatch, ["RAM()", "CPU(Intel Rapl)"])
    with runinfo.track_energy() as energy:
        pass
    assert energy["cpu_method"] == "rapl" and energy["gpu_method"] is None


@pytest.fixture
def mlflow_store(tmp_path, monkeypatch):
    """A throwaway SQLite store; returns a client that reads it back."""
    pytest.importorskip("mlflow")
    from mlflow.tracking import MlflowClient

    uri = f"sqlite:///{tmp_path / 'tracking.db'}"
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    monkeypatch.setenv("MLFLOW_DISABLE_AGENT_HINT", "1")
    monkeypatch.chdir(tmp_path)  # an artifact root, if MLflow wants one, lands here
    return MlflowClient(uri)


def _only_run(client, experiment):
    (exp,) = [e for e in client.search_experiments() if e.name == experiment]
    (run,) = client.search_runs([exp.experiment_id])
    return run


def test_tracking_records_a_run_with_provenance(mlflow_store, tmp_path, monkeypatch):
    monkeypatch.setenv("CENSUS_IMAGE_DIGEST", "sha256:abc")
    data = tmp_path / "train.jsonl"
    data.write_bytes(b"train\n")
    with runinfo.tracking(tmp_path / "unused.db", "census-s", "r", "train") as t:
        t.params({"seed": 5, "split.dev": "1 in 20"})
        t.dataset(data, "train")
        t.metrics({"best_f1": 0.5}, step=1)
        t.energy(
            {
                "tracked": True,
                "country": "NLD",
                "grid": "g",
                "cpu_method": "rapl",
                "gpu_method": None,
                "ram_method": "estimate",
                "kwh": 0.5,
                "cpu_kwh": 0.1,
                "gpu_kwh": 0.3,
                "ram_kwh": 0.1,
                "co2e_kg": 0.2,
                "seconds": 12.0,
            }
        )
    run = _only_run(mlflow_store, "census-s")
    assert run.info.run_name == "r" and run.info.status == "FINISHED"
    assert run.data.params["seed"] == "5"
    assert run.data.params["sha256.train.jsonl"] == hashlib.sha256(b"train\n").hexdigest()
    (ds,) = run.inputs.dataset_inputs
    assert ds.dataset.name == "train.jsonl" and hashlib.sha256(b"train\n").hexdigest().startswith(ds.dataset.digest)
    assert run.data.metrics["best_f1"] == 0.5 and run.data.metrics["energy_kwh"] == 0.5
    tags = run.data.tags
    assert len(tags["mlflow.source.git.commit"]) == 40 and tags["git_dirty"] in ("True", "False")
    assert tags["uv_lock_sha256"] == hashlib.sha256((runinfo.PACKAGE / "uv.lock").read_bytes()).hexdigest()
    assert tags["image_digest"] == "sha256:abc" and tags["kind"] == "train"
    assert tags["energy_cpu_method"] == "rapl" and "energy_gpu_method" not in tags


def test_tracking_marks_a_failed_run(mlflow_store, tmp_path):
    with pytest.raises(RuntimeError), runinfo.tracking(tmp_path / "u.db", "census-s", "r", "train"):
        raise RuntimeError("out of memory")
    assert _only_run(mlflow_store, "census-s").info.status == "FAILED"


def test_tracking_is_skipped_without_mlflow(monkeypatch, capsys, tmp_path):
    monkeypatch.setitem(sys.modules, "mlflow", None)
    with runinfo.tracking(tmp_path / "u.db", "census-s", "r", "train") as t:
        t.params({"seed": 1})
        t.dataset(tmp_path / "missing.jsonl", "train")
        t.metrics({"f1": 1.0})
        t.energy({"tracked": False, "reason": "x"})
    assert "tracking skipped" in capsys.readouterr().out
    assert not (tmp_path / "u.db").exists()


def test_default_store_is_the_census_data_dir(monkeypatch, tmp_path):
    pytest.importorskip("mlflow")
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    monkeypatch.setenv("MLFLOW_DISABLE_AGENT_HINT", "1")
    monkeypatch.chdir(tmp_path)
    with runinfo.tracking(tmp_path / "mlflow.db", "census-s", "r", "train"):
        pass
    assert (tmp_path / "mlflow.db").exists()


def test_epoch_metrics_come_from_the_training_log(mlflow_store, tmp_path):
    log = tmp_path / "metrics.jsonl"
    log.write_text(
        "\n".join(
            json.dumps(r)
            for r in (
                {"git_commit": "x"},
                {"step": 1, "of": 4, "loss": 0.7, "seconds": 1},
                {"epoch": 1, "seconds": 10, "dev": {"0.3": {"f1": 0.8}, "0.4": {"f1": 0.9}}},
                {"epoch": 2, "seconds": 20, "dev": {"0.4": {"f1": 0.7}}},
            )
        )
    )
    with runinfo.tracking(tmp_path / "u.db", "census-s", "r", "train") as t:
        t.epochs(log)
    run = _only_run(mlflow_store, "census-s")
    f1 = mlflow_store.get_metric_history(run.info.run_id, "dev_f1")
    assert [(m.step, m.value) for m in f1] == [(1, 0.9), (2, 0.7)]


def test_cli_train_and_predict_are_tracked(mlflow_store, tmp_path, monkeypatch):
    from census import cli, encoder

    monkeypatch.setattr(cli, "DATA", tmp_path)
    monkeypatch.setattr(runinfo, "base_model", lambda repo, rev: {"repo": repo, "revision": rev, "weights_sha256": "w"})
    snap = tmp_path / "model" / "s"
    (snap / "dataset").mkdir(parents=True)
    (snap / "dataset" / "train.jsonl").write_bytes(b"train\n")
    (snap / "dataset" / "held_out.jsonl").write_bytes(b'{"pmcid": "PMC1"}\n')

    def fake_train(config, dataset, run):
        (run / "checkpoint").mkdir(parents=True)
        (run / "checkpoint" / "model.safetensors").write_bytes(b"weights")
        (run / "metrics.jsonl").write_text(json.dumps({"epoch": 1, "seconds": 9, "dev": {"0.4": {"f1": 0.5}}}) + "\n")
        (run / "best.json").write_text("{}")
        return {"epoch": 1, "f1": 0.5, "precision": 0.4, "recall": 0.6, "exact": 0.3, "threshold": 0.4}

    def fake_predict(run, items, out, device):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}\n")
        return 1

    monkeypatch.setattr(encoder, "train", fake_train)
    monkeypatch.setattr(encoder, "predict", fake_predict)
    monkeypatch.setitem(sys.modules, "codecarbon", None)
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r", "--seed", "5"]) == 0
    assert cli.main(["model", "predict", "--snapshot", "s", "--name", "r"]) == 0
    train, predict = sorted(
        mlflow_store.search_runs([mlflow_store.get_experiment_by_name("census-s").experiment_id]),
        key=lambda r: r.data.tags["kind"],
        reverse=True,
    )
    weights = hashlib.sha256(b"weights").hexdigest()
    assert train.data.params["config.seed"] == "5"
    assert train.data.params["base_model.repo"] == "answerdotai/ModernBERT-base"
    assert train.data.params["weights_sha256"] == weights
    assert train.data.params["sha256.train.jsonl"] == hashlib.sha256(b"train\n").hexdigest()
    assert train.data.params["split.held_out_seed"]
    assert train.data.metrics["best_f1"] == 0.5 and train.data.metrics["dev_f1"] == 0.5
    assert train.data.tags["energy_tracked"] == "False"
    assert predict.data.tags["kind"] == "predict" and predict.data.params["weights_sha256"] == weights
    assert predict.data.metrics["articles"] == 1
