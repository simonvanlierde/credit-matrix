import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from test_modelset import make_db

from census import cli, readers
from census.rows import Rows


def article(i: int, style: str, statement: str | None, roles: list) -> Rows:
    fields = {
        "pmcid": f"PMC{i}",
        "stratum": "all",
        "style": style,
        "authors": ["Ann Smith", "Bo Jones", "Cy Berg"],
        "n_authors": 3,
        "n_authors_with_roles": len({p for p, _ in roles}),
        "statement": statement,
    }
    return Rows(fields, roles=roles)


ROWS = [
    article(1, "jats4r", "tagged text", [(1, "software")]),
    article(2, "contrib_text", "1: Software", [(1, "software")]),
    article(3, "statement_text", "AS: software.", [(1, "software")]),
    article(4, "none", "Ann designed the study.", []),
    article(5, "none", None, []),
]


def write_parts(path, pairs: dict):
    """An article with no role has one row with a null position and role."""
    rows = [(p, *pair) for p, found in pairs.items() for pair in (found or [(None, None)])]
    pmcid, position, role = (list(column) for column in zip(*rows, strict=True))
    pq.write_table(
        pa.table(
            {
                "pmcid": pa.array(pmcid),
                "author_position": pa.array(position, pa.int32()),
                "role": pa.array(role, pa.string()),
            }
        ),
        path,
    )


def census(con):
    readers.use_roles(con)
    articles = {
        r[0]: r[1:] for r in con.execute("SELECT pmcid, reader, n_authors_with_roles FROM census_articles").fetchall()
    }
    roles = {}
    for pmcid, position, role in con.execute("SELECT * FROM census_roles").fetchall():
        roles.setdefault(pmcid, set()).add((position, role))
    return articles, roles


def test_without_an_applied_run_the_rules_read_and_narrative_has_no_roles(tmp_path):
    with make_db(tmp_path / "a.duckdb", ROWS) as con:
        articles, roles = census(con)
    assert {p: a[0] for p, a in articles.items()} == {
        "PMC1": "tags",
        "PMC2": "rules",
        "PMC3": "rules",
        "PMC4": None,
        "PMC5": None,
    }
    assert roles == {"PMC1": {(1, "software")}, "PMC2": {(1, "software")}, "PMC3": {(1, "software")}}


def test_applied_encoder_reads_statements_but_not_tags_or_contrib_text(tmp_path):
    parts = tmp_path / "part-00000.parquet"
    write_parts(
        parts,
        {
            "PMC1": [(2, "validation")],  # a tagged article: ignored
            "PMC2": [(2, "validation")],  # contrib_text: ignored
            "PMC3": [(1, "software"), (2, "validation"), (9, "resources")],  # position 9 is no author
            "PMC4": [(1, "conceptualization")],  # narrative
            "PMC5": [],
        },
    )
    with make_db(tmp_path / "a.duckdb", ROWS) as con:
        assert readers.apply_encoder(con, str(tmp_path / "part-*.parquet"), "run-1") == (2, 4)
        assert con.execute("SELECT value FROM meta WHERE key = 'encoder'").fetchall() == [("run-1",)]
        articles, roles = census(con)
    assert articles["PMC1"] == ("tags", 1) and articles["PMC2"] == ("rules", 1)
    assert articles["PMC3"] == ("encoder", 2) and articles["PMC4"] == ("encoder", 1)
    assert articles["PMC5"] == (None, 0)
    assert roles["PMC1"] == roles["PMC2"] == {(1, "software")}
    assert roles["PMC3"] == {(1, "software"), (2, "validation")}
    assert roles["PMC4"] == {(1, "conceptualization")}


def test_apply_refuses_parts_that_miss_a_statement_and_changes_nothing(tmp_path):
    write_parts(tmp_path / "part-00000.parquet", {"PMC3": [(1, "software")]})  # PMC4 missing
    with make_db(tmp_path / "a.duckdb", ROWS) as con:
        with pytest.raises(ValueError, match="1 of the 2 statements"):
            readers.apply_encoder(con, str(tmp_path / "part-*.parquet"), "run-1")
        assert con.execute(
            "SELECT count(*) FROM duckdb_tables() WHERE table_name = 'encoder_assignments'"
        ).fetchone() == (0,)
        assert con.execute("SELECT count(*) FROM meta WHERE key = 'encoder'").fetchone() == (0,)


def test_apply_command_works_on_a_database_another_parser_built(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli, "DATA", tmp_path)
    db = tmp_path / "oa-2026-10.duckdb"
    make_db(db, ROWS).execute("UPDATE meta SET value = 'older' WHERE key = 'parser'")
    argv = ["model", "apply", "--name", "run-1", "--snapshot", "oa-2026-10"]
    assert cli.main(argv) == 1
    assert "no parts" in capsys.readouterr().err
    parts = tmp_path / "model" / "oa-2026-10" / "predictions" / "encoder-run-1-corpus"
    parts.mkdir(parents=True)
    write_parts(parts / "part-00000.parquet", {"PMC3": [(1, "software")], "PMC4": []})
    assert cli.main(argv) == 0
    assert "2 statements, 1 pairs" in capsys.readouterr().out
