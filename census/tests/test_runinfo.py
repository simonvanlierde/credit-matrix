import contextlib
import hashlib
import json
import os
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


def _fake_codecarbon(monkeypatch, hardware, fail=None):
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

        def start(self):
            if fail == "start":
                raise RuntimeError("sensor failed")

        def stop(self):
            seen["stopped"] = True
            if fail == "stop":
                raise RuntimeError("sensor failed")

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
    """An isolated SQLite store in memory; the default-store test covers disk persistence."""
    pytest.importorskip("mlflow")
    from mlflow.tracking import MlflowClient

    uri = f"sqlite:///file:{tmp_path / 'tracking'}?mode=memory&cache=shared&uri=true"
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
    assert ds.dataset.source_type == "local" and json.loads(ds.dataset.source) == {"uri": data.as_uri()}
    assert {tag.key: tag.value for tag in ds.tags} == {"mlflow.data.context": "train"}
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


@pytest.mark.parametrize("corpus", [False, True])
def test_cli_train_and_predict_are_tracked(mlflow_store, tmp_path, monkeypatch, corpus):
    from census import cli, encoder

    monkeypatch.setattr(cli, "DATA", tmp_path)
    base_weights = tmp_path / "base.safetensors"

    def cached_model(repo, rev):
        return {
            "repo": repo,
            "revision": rev,
            "weights_sha256": runinfo.sha256(base_weights) if base_weights.exists() else None,
        }

    monkeypatch.setattr(runinfo, "base_model", cached_model)
    (tmp_path / "s.duckdb").touch()
    snap = tmp_path / "model" / "s"
    (snap / "dataset").mkdir(parents=True)
    (snap / "dataset" / "train.jsonl").write_bytes(b"train\n")
    (snap / "dataset" / "held_out.jsonl").write_bytes(b'{"pmcid": "PMC1"}\n')

    def fake_train(config, dataset, run):
        base_weights.write_bytes(b"base weights")
        (run / "checkpoint").mkdir(parents=True)
        (run / "checkpoint" / "model.safetensors").write_bytes(b"weights")
        (run / "metrics.jsonl").write_text(json.dumps({"epoch": 1, "seconds": 9, "dev": {"0.4": {"f1": 0.5}}}) + "\n")
        (run / "best.json").write_text("{}")
        return {"epoch": 1, "f1": 0.5, "precision": 0.4, "recall": 0.6, "exact": 0.3, "threshold": 0.4}

    def fake_predict(run, items, out, device):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}\n")
        return 1

    def fake_predict_corpus(run, chunks, out, device, total):
        assert list(chunks) == [[{"pmcid": "PMC1"}]] and total == 1
        out.mkdir(parents=True)
        return 1

    monkeypatch.setattr(encoder, "predict_corpus", fake_predict_corpus)
    monkeypatch.setattr(cli.store, "connect", lambda *a, **kw: contextlib.nullcontext(None))
    monkeypatch.setattr(cli.modelset, "count_free_text", lambda con, limit: 1)
    monkeypatch.setattr(cli.modelset, "free_text_chunks", lambda con, chunk, limit: [[{"pmcid": "PMC1"}]])
    monkeypatch.setattr(encoder, "train", fake_train)
    monkeypatch.setattr(encoder, "predict", fake_predict)
    monkeypatch.setitem(sys.modules, "codecarbon", None)
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r", "--seed", "5"]) == 0
    assert cli.main(["model", "predict", "--snapshot", "s", "--name", "r", *(["--corpus"] if corpus else [])]) == 0
    train, predict = sorted(
        mlflow_store.search_runs([mlflow_store.get_experiment_by_name("census-s").experiment_id]),
        key=lambda r: r.data.tags["kind"],
        reverse=True,
    )
    weights = hashlib.sha256(b"weights").hexdigest()
    assert train.data.params["config.seed"] == "5"
    assert train.data.params["base_model.repo"] == "answerdotai/ModernBERT-base"
    assert train.data.params["base_model.weights_sha256"] == hashlib.sha256(b"base weights").hexdigest()
    assert train.data.params["weights_sha256"] == weights
    assert train.data.params["sha256.train.jsonl"] == hashlib.sha256(b"train\n").hexdigest()
    assert train.data.params["split.held_out_seed"]
    assert train.data.metrics["best_f1"] == 0.5 and train.data.metrics["dev_f1"] == 0.5
    assert train.data.tags["energy_tracked"] == "False"
    assert predict.data.tags["kind"] == "predict" and predict.data.params["weights_sha256"] == weights
    assert predict.data.metrics["articles"] == 1
    assert predict.data.params["output"] == ("encoder-r-corpus" if corpus else "encoder-r-held_out.jsonl")
    assert predict.data.params["output_sha256"] == ("None" if corpus else hashlib.sha256(b"{}\n").hexdigest())


@pytest.mark.parametrize("fail", ["start", "stop"])
def test_energy_failure_still_cleans_up_and_preserves_job_error(monkeypatch, fail):
    seen = _fake_codecarbon(monkeypatch, [], fail=fail)
    with pytest.raises(ValueError, match="training failed"), runinfo.track_energy() as energy:
        raise ValueError("training failed")
    assert seen["stopped"]
    assert energy["tracked"] is False and "sensor failed" in energy["reason"]


@pytest.mark.parametrize("kind", ["train", "predict"])
def test_failed_command_records_energy(mlflow_store, tmp_path, monkeypatch, kind):
    from census import cli, encoder

    monkeypatch.setattr(cli, "DATA", tmp_path)
    monkeypatch.setattr(
        runinfo, "base_model", lambda repo, rev: {"repo": repo, "revision": rev, "weights_sha256": None}
    )
    dataset = tmp_path / "model" / "s" / "dataset"
    dataset.mkdir(parents=True)
    (dataset / "train.jsonl").write_text("{}\n")
    (dataset / "held_out.jsonl").write_text("{}\n")
    if kind == "predict":
        run = dataset.parent / "runs" / "r"
        (run / "checkpoint").mkdir(parents=True)
        (run / "checkpoint" / "model.safetensors").write_bytes(b"weights")
        (run / "best.json").write_text("{}")

    def fail(*args, **kwargs):
        raise RuntimeError("training failed")

    monkeypatch.setattr(encoder, kind, fail)
    _fake_codecarbon(monkeypatch, ["CPU(Intel Rapl)"])
    with pytest.raises(RuntimeError, match="training failed"):
        cli.main(["model", kind, "--snapshot", "s", "--name", "r"])
    run = _only_run(mlflow_store, "census-s")
    assert run.info.status == "FAILED"
    assert run.data.metrics["energy_kwh"] == 0.5


def _write_run(runs, name, finished=True, epochs=1):
    run = runs / name
    run.mkdir(parents=True)
    (run / "config.json").write_text(json.dumps({"model": "m", "epochs": epochs, "dev_articles": 2000}))
    dev = {"0.3": {"f1": 0.8}, "0.5": {"f1": 0.9}}
    log = [
        {"git_commit": "a" * 40, "train_articles": 10},
        {"step": 1, "of": 2, "loss": 0.5, "seconds": 1},
        {"epoch": 1, "seconds": 5, "dev": dev},
    ]
    (run / "metrics.jsonl").write_text("\n".join(json.dumps(r) for r in log) + "\n")
    if finished:
        (run / "best.json").write_text(json.dumps({"epoch": 1, "threshold": 0.5, "f1": 0.9}))


def test_backfill_records_old_runs_once(mlflow_store, tmp_path):
    runs = tmp_path / "runs"
    _write_run(runs, "done")
    _write_run(runs, "stopped", finished=False, epochs=2)
    (runs / "not-a-run").mkdir()
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (2, 0)
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (0, 2)  # a rerun adds nothing
    (exp,) = [e for e in mlflow_store.search_experiments() if e.name == "census-s"]
    found = {r.data.tags["run_dir"]: r for r in mlflow_store.search_runs([exp.experiment_id])}
    assert set(found) == {"done", "stopped"}
    done, stopped = found["done"], found["stopped"]
    assert done.data.params["config.dev_articles"] == "2000"
    assert done.data.metrics["best_f1"] == 0.9 and done.data.metrics["dev_f1"] == 0.9
    history = mlflow_store.get_metric_history(done.info.run_id, "dev_f1")
    assert [(m.step, m.value) for m in history] == [(1, 0.9)]
    assert done.data.tags["mlflow.source.git.commit"] == "a" * 40
    assert done.data.tags["manifest.train_articles"] == "10" and done.data.tags["finished"] == "True"
    assert "best_f1" not in stopped.data.metrics and stopped.data.tags["finished"] == "False"


def test_backfill_skips_a_live_tracked_run(mlflow_store, tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    _write_run(runs, "live")
    with runinfo.tracking(tmp_path / "unused.db", "census-s", "live", "train"):
        pass
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (0, 1)


def test_cli_train_tags_run_dir(mlflow_store, tmp_path, monkeypatch):
    from census import cli, encoder

    monkeypatch.setattr(cli, "DATA", tmp_path)
    monkeypatch.setattr(runinfo, "base_model", lambda repo, rev: {"repo": repo, "revision": rev})
    dataset = tmp_path / "model" / "s" / "dataset"
    dataset.mkdir(parents=True)
    (dataset / "train.jsonl").write_text("{}\n")

    def train(config, data, run):
        _write_run(run.parent, run.name)
        (run / "checkpoint").mkdir()
        (run / "checkpoint" / "model.safetensors").write_bytes(b"w")
        return {"epoch": 1, "threshold": 0.5, "f1": 0.9}

    monkeypatch.setattr(encoder, "train", train)
    _fake_codecarbon(monkeypatch, ["CPU(Intel Rapl)"])
    cli.main(["model", "train", "--snapshot", "s", "--name", "r"])
    assert _only_run(mlflow_store, "census-s").data.tags["run_dir"] == "r"
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", dataset.parent / "runs") == (0, 1)


def test_backfill_retries_a_bad_run_dir(mlflow_store, tmp_path, capsys):
    runs = tmp_path / "runs"
    _write_run(runs, "ok")
    _write_run(runs, "cut")
    log = runs / "cut" / "metrics.jsonl"
    log.write_text(log.read_text()[:-20])  # a last line cut short
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (1, 0)
    assert "skipped cut" in capsys.readouterr().err
    _write_run(runs.parent / "fixed", "cut")
    (runs / "cut" / "metrics.jsonl").write_text((runs.parent / "fixed" / "cut" / "metrics.jsonl").read_text())
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (1, 1)


def test_backfill_finished_counts_epochs(mlflow_store, tmp_path):
    runs = tmp_path / "runs"
    _write_run(runs, "part", epochs=3)  # one of three epochs, with a best.json
    os.utime(runs / "part" / "config.json", (1_700_000_000, 1_700_000_000))
    runinfo.backfill(tmp_path / "unused.db", "census-s", runs)
    (exp,) = [e for e in mlflow_store.search_experiments() if e.name == "census-s"]
    (run,) = mlflow_store.search_runs([exp.experiment_id])
    assert run.data.tags["finished"] == "False" and run.info.start_time == 1_700_000_000_000


def test_backfill_leaves_live_runs_that_did_not_finish(mlflow_store, tmp_path):
    runs = tmp_path / "runs"
    exp_id = mlflow_store.create_experiment("census-s")
    for name, status in (("running", None), ("failed", "FAILED"), ("killed", "KILLED")):
        _write_run(runs, name)
        run = mlflow_store.create_run(exp_id, run_name=name, tags={"run_dir": name})
        if status:
            mlflow_store.set_terminated(run.info.run_id, status)
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (0, 3)
    assert len(mlflow_store.search_runs([exp_id])) == 3


def test_backfill_replaces_a_failed_import(mlflow_store, tmp_path):
    runs = tmp_path / "runs"
    _write_run(runs, "r")
    exp_id = mlflow_store.create_experiment("census-s")
    old = mlflow_store.create_run(exp_id, run_name="r", tags={"run_dir": "r", "backfilled": "True"}).info.run_id
    mlflow_store.set_terminated(old, "FAILED")
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (1, 0)
    assert mlflow_store.get_run(old).info.lifecycle_stage == "deleted"
    (new,) = mlflow_store.search_runs([exp_id])
    assert new.info.run_id != old and new.info.status == "FINISHED"


def test_backfill_skips_a_run_mlflow_refuses(mlflow_store, tmp_path, capsys):
    runs = tmp_path / "runs"
    _write_run(runs, "a-bad")
    (runs / "a-bad" / "best.json").write_text(json.dumps({"f1": "x"}))
    _write_run(runs, "b-ok")
    assert runinfo.backfill(tmp_path / "unused.db", "census-s", runs) == (1, 0)
    assert "skipped a-bad: " in capsys.readouterr().err


def test_backfill_ends_a_run_at_its_last_file(mlflow_store, tmp_path):
    runs = tmp_path / "runs"
    _write_run(runs, "old")
    for f in (runs / "old").iterdir():
        os.utime(f, (1_700_000_000, 1_700_000_000))
    os.utime(runs / "old" / "best.json", (1_700_003_600, 1_700_003_600))
    runinfo.backfill(tmp_path / "unused.db", "census-s", runs)
    run = _only_run(mlflow_store, "census-s")
    assert run.info.start_time == 1_700_000_000_000 and run.info.end_time == 1_700_003_600_000
    assert run.info.end_time - run.info.start_time < 86_400_000


def test_cli_backfill(mlflow_store, tmp_path, monkeypatch, capsys):
    from census import cli

    monkeypatch.setattr(cli, "DATA", tmp_path)
    assert cli.main(["model", "backfill", "--snapshot", "s"]) == 1
    assert "no run directories" in capsys.readouterr().err
    _write_run(tmp_path / "model" / "s" / "runs", "r")
    assert cli.main(["model", "backfill", "--snapshot", "s"]) == 0
    assert "1 runs added to MLflow, 0 already there" in capsys.readouterr().out


def test_readme_ui_matches_the_locked_client():
    import re
    import tomllib

    readme = (runinfo.PACKAGE / "README.md").read_text(encoding="utf-8")
    (ui,) = set(re.findall(r"mlflow==([\w.]+)", readme))
    lock = tomllib.loads((runinfo.PACKAGE / "uv.lock").read_text(encoding="utf-8"))
    (client,) = [p["version"] for p in lock["package"] if p["name"] == "mlflow-skinny"]
    assert ui == client
