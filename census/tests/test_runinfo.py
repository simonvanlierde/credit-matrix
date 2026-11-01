import hashlib
import json
import sys
import types

from census import runinfo


def test_write_records_commit_lock_hash_and_sections(tmp_path):
    path = runinfo.write(tmp_path / "manifest.json", "train", seed=7, energy={"tracked": False})
    m = json.loads(path.read_text())
    assert m["kind"] == "train" and m["seed"] == 7
    assert m["git_commit"] and len(m["git_commit"]) == 40
    assert m["uv_lock_sha256"] == hashlib.sha256((runinfo.PACKAGE / "uv.lock").read_bytes()).hexdigest()
    assert m["energy"] == {"tracked": False}


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


def test_cli_train_and_predict_write_manifests(tmp_path, monkeypatch):
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
        (run / "best.json").write_text("{}")
        return {"epoch": 1, "f1": 0.5, "threshold": 0.4}

    def fake_predict(run, items, out, device):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}\n")
        return 1

    monkeypatch.setattr(encoder, "train", fake_train)
    monkeypatch.setattr(encoder, "predict", fake_predict)
    monkeypatch.setitem(sys.modules, "codecarbon", None)
    assert cli.main(["model", "train", "--snapshot", "s", "--name", "r", "--seed", "5"]) == 0
    m = json.loads((snap / "runs" / "r" / "manifest.json").read_text())
    assert m["seed"] == 5 and m["metrics"]["f1"] == 0.5
    assert m["data"]["train.jsonl"] == hashlib.sha256(b"train\n").hexdigest()
    assert m["weights_sha256"] == hashlib.sha256(b"weights").hexdigest()
    assert m["base_model"]["repo"] == "answerdotai/ModernBERT-base"
    assert m["split"]["held_out_seed"] and m["energy"]["tracked"] is False
    assert cli.main(["model", "predict", "--snapshot", "s", "--name", "r"]) == 0
    (predict_manifest,) = (snap / "runs" / "r").glob("predict-*.json")
    p = json.loads(predict_manifest.read_text())
    assert p["kind"] == "predict" and p["result"]["articles"] == 1 and p["energy"]["tracked"] is False
