import json
from pathlib import Path

from fusion.cli import main
from stubs.mock_models import generate_batch, generate_scan

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "routing.toml"


def test_mock_scan_is_deterministic():
    assert generate_scan(7) == generate_scan(7)


def test_mock_scans_differ_across_seeds():
    assert generate_scan(1) != generate_scan(2)


def test_mock_batch_parses_and_routes():
    from fusion.config import RoutingConfig
    from fusion.contracts import ScanInput
    from fusion.engine import decide

    config = RoutingConfig.load(CONFIG_PATH)
    for payload in generate_batch(50):
        decision = decide(ScanInput.from_dict(payload), config)
        assert 1 <= decision.bin_index <= 8


def test_cli_routes_a_single_scan(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(3)), encoding="utf-8")

    exit_code = main(["--config", str(CONFIG_PATH), str(infile)])
    assert exit_code == 0

    out = json.loads(capsys.readouterr().out)
    assert out["scan_id"]
    assert 1 <= out["bin_index"] <= 8


def test_cli_routes_a_json_array(tmp_path, capsys):
    infile = tmp_path / "scans.json"
    infile.write_text(json.dumps(generate_batch(5)), encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), str(infile)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert isinstance(out, list) and len(out) == 5


def test_cli_reads_stdin(monkeypatch, capsys):
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(generate_scan(11))))
    assert main(["--config", str(CONFIG_PATH), "-"]) == 0
    assert json.loads(capsys.readouterr().out)["bin_index"] >= 1


def test_cli_reports_a_bad_payload(tmp_path, capsys):
    infile = tmp_path / "bad.json"
    infile.write_text('{"models": {}}', encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), str(infile)]) == 1
    assert "scan_id" in capsys.readouterr().err


def test_cli_reports_a_missing_config(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(1)), encoding="utf-8")

    assert main(["--config", str(tmp_path / "nope.toml"), str(infile)]) == 2
    assert "cannot read" in capsys.readouterr().err


def test_cli_explain_prints_the_trace(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(3)), encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), "--explain", str(infile)]) == 0
    err = capsys.readouterr().err
    assert "confidence_gate" in err
