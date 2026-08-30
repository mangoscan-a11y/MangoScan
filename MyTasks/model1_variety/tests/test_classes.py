import pytest

from mango_variety.classes import (
    CLASSES,
    UnknownClassError,
    class_index,
    from_dirname,
    to_dirname,
)


def test_six_canonical_classes_in_a_fixed_order():
    assert CLASSES == (
        "Carabao",
        "Apple Mango",
        "Indian",
        "Chupadera",
        "Wani",
        "Kabayo",
    )


def test_it_is_wani_not_wanni():
    """Guards the DB spelling. A rename here breaks the Supabase FK."""
    assert "Wani" in CLASSES
    assert "Wanni" not in CLASSES


@pytest.mark.parametrize("label", CLASSES)
def test_dirname_round_trip(label):
    assert from_dirname(to_dirname(label)) == label


def test_spaces_become_underscores():
    assert to_dirname("Apple Mango") == "Apple_Mango"


def test_class_index_matches_position():
    assert class_index("Carabao") == 0
    assert class_index("Kabayo") == 5


def test_unknown_label_raises():
    with pytest.raises(UnknownClassError):
        class_index("Alphonso")


def test_unknown_dirname_raises():
    with pytest.raises(UnknownClassError):
        from_dirname("Alphonso")


def test_pure_core_has_no_third_party_imports():
    """The core must keep running on local Python 3.14, where PyTorch and
    Ultralytics have no wheels. A stray `import numpy` breaks that."""
    import ast
    import pathlib
    import sys

    offenders = []
    core = pathlib.Path(__file__).resolve().parents[1] / "mango_variety"
    for path in core.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                name = (
                    node.module
                    if isinstance(node, ast.ImportFrom)
                    else node.names[0].name
                )
                root = (name or "").split(".")[0]
                if (
                    root
                    and root not in sys.stdlib_module_names
                    and root != "mango_variety"
                ):
                    offenders.append((path.name, root))
    assert offenders == []
