"""Canonical label vocabulary.

These strings must match the reference tables in Supabase exactly. A
mismatch here surfaces as a foreign-key failure at insert time, long
after the misclassification actually happened.
"""

VARIETIES: tuple[str, ...] = (
    "Carabao",
    "Apple Mango",
    "Indian",
    "Chupadera",
    "Wani",
    "Kabayo",
)

DISEASES: tuple[str, ...] = ("Healthy", "Anthracnose", "Mango Scab")

COLORS: tuple[str, ...] = ("Green", "Yellow")

SIZES: tuple[str, ...] = ("Small", "Medium", "Large")

#: Dimensions that determine the physical bin. Variety is deliberately
#: absent - it is a QC check, never a routing input.
ROUTING_DIMENSIONS: tuple[str, ...] = ("disease", "bruise", "color", "size")

ALL_DIMENSIONS: tuple[str, ...] = ("variety",) + ROUTING_DIMENSIONS
