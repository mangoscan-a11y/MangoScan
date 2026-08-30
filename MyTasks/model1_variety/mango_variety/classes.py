"""The six variety labels, and the on-disk directory names they map to.

Order is significant: it defines the class index the trained model emits,
so reordering this tuple silently invalidates every existing checkpoint.
"""

from __future__ import annotations


class UnknownClassError(ValueError):
    """A label or directory name is not one of the six known varieties."""


#: Must match `mango_varieties.variety_name` in Supabase, exactly.
CLASSES: tuple[str, ...] = (
    "Carabao",
    "Apple Mango",
    "Indian",
    "Chupadera",
    "Wani",
    "Kabayo",
)


def to_dirname(label: str) -> str:
    """`'Apple Mango'` -> `'Apple_Mango'`. Spaces in paths invite quoting bugs."""
    if label not in CLASSES:
        raise UnknownClassError(f"{label!r} is not a known variety")
    return label.replace(" ", "_")


def from_dirname(name: str) -> str:
    """`'Apple_Mango'` -> `'Apple Mango'`."""
    label = name.replace("_", " ")
    if label not in CLASSES:
        raise UnknownClassError(f"directory {name!r} is not a known variety")
    return label


def class_index(label: str) -> int:
    try:
        return CLASSES.index(label)
    except ValueError as exc:
        raise UnknownClassError(f"{label!r} is not a known variety") from exc
