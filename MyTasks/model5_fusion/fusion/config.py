"""Loads and validates `routing.toml`.

Validation is strict and happens at load time. A config that cannot route
every legal color/size pair is a config that will strand a mango on the
belt at 3am, so it fails here instead.
"""

from __future__ import annotations

import hashlib
import tomllib
from dataclasses import dataclass
from pathlib import Path

from fusion.vocab import ALL_DIMENSIONS, COLORS, SIZES


class ConfigError(ValueError):
    """The routing config is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class BinSpec:
    index: int
    name: str
    verdict: str
    servo1_action: str
    servo2_action: str
    color: str | None = None
    size: str | None = None


@dataclass(frozen=True)
class SizeGrade:
    name: str
    min_grams: float
    max_grams: float


@dataclass(frozen=True)
class RoutingConfig:
    engine_version: str
    thresholds: dict[str, float]
    disease_reject_labels: tuple[str, ...]
    low_confidence_bin: int
    size_grades: tuple[SizeGrade, ...]
    bins: tuple[BinSpec, ...]
    config_version: str

    @classmethod
    def load(cls, path: str | Path) -> RoutingConfig:
        path = Path(path)
        try:
            raw_bytes = path.read_bytes()
        except OSError as exc:
            raise ConfigError(f"cannot read routing config at {path}: {exc}") from exc

        try:
            data = tomllib.loads(raw_bytes.decode("utf-8"))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
            raise ConfigError(f"{path} is not valid TOML: {exc}") from exc

        digest = hashlib.sha256(raw_bytes).hexdigest()
        config_version = f"{path.name}@sha256:{digest[:16]}"

        thresholds = cls._parse_thresholds(data)
        bins = cls._parse_bins(data)
        grades = cls._parse_size_grades(data)

        low_conf_bin = int(data.get("low_confidence", {}).get("bin_index", 0))
        if not any(b.index == low_conf_bin for b in bins):
            raise ConfigError(
                f"low_confidence.bin_index={low_conf_bin} is not a defined bin"
            )

        reject_labels = tuple(data.get("disease", {}).get("reject_labels", ()))
        if not reject_labels:
            raise ConfigError("disease.reject_labels must list at least one label")

        config = cls(
            engine_version=str(data.get("engine_version", "unknown")),
            thresholds=thresholds,
            disease_reject_labels=reject_labels,
            low_confidence_bin=low_conf_bin,
            size_grades=grades,
            bins=bins,
            config_version=config_version,
        )
        config._validate_grid()
        return config

    @staticmethod
    def _parse_thresholds(data: dict) -> dict[str, float]:
        raw = data.get("thresholds", {})
        thresholds: dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            if dim not in raw:
                raise ConfigError(f"thresholds.{dim} is missing")
            value = float(raw[dim])
            if not 0.0 <= value <= 1.0:
                raise ConfigError(f"thresholds.{dim}={value} is outside [0, 1]")
            thresholds[dim] = value
        return thresholds

    @staticmethod
    def _parse_bins(data: dict) -> tuple[BinSpec, ...]:
        entries = data.get("bins", [])
        if not entries:
            raise ConfigError("config defines no bins")
        bins: list[BinSpec] = []
        seen: set[int] = set()
        for entry in entries:
            index = int(entry["index"])
            if index in seen:
                raise ConfigError(f"duplicate bin index {index}")
            seen.add(index)
            verdict = str(entry["verdict"])
            if verdict not in ("passed", "rejected"):
                raise ConfigError(
                    f"bin {index}: verdict must be 'passed' or 'rejected', got {verdict!r}"
                )
            bins.append(
                BinSpec(
                    index=index,
                    name=str(entry["name"]),
                    verdict=verdict,
                    servo1_action=str(entry["servo1_action"]),
                    servo2_action=str(entry["servo2_action"]),
                    color=entry.get("color"),
                    size=entry.get("size"),
                )
            )
        return tuple(bins)

    @staticmethod
    def _parse_size_grades(data: dict) -> tuple[SizeGrade, ...]:
        entries = data.get("size_grades", [])
        if not entries:
            raise ConfigError("config defines no size_grades")
        grades = tuple(
            SizeGrade(
                name=str(e["name"]),
                min_grams=float(e["min_grams"]),
                max_grams=float(e["max_grams"]),
            )
            for e in entries
        )
        for grade in grades:
            if grade.min_grams >= grade.max_grams:
                raise ConfigError(
                    f"size grade {grade.name}: min_grams must be below max_grams"
                )
        return grades

    def _validate_grid(self) -> None:
        for color in COLORS:
            for size in SIZES:
                if not any(
                    b.color == color and b.size == size for b in self.bins
                ):
                    raise ConfigError(f"no bin for {color} x {size}")

    def bin_for(self, color: str, size: str) -> BinSpec:
        for spec in self.bins:
            if spec.color == color and spec.size == size:
                return spec
        raise ConfigError(f"no bin for {color} x {size}")

    def bin_by_index(self, index: int) -> BinSpec:
        for spec in self.bins:
            if spec.index == index:
                return spec
        raise ConfigError(f"no bin with index {index}")

    def grade_for_grams(self, grams: float) -> str:
        for grade in self.size_grades:
            if grade.min_grams <= grams < grade.max_grams:
                return grade.name
        raise ConfigError(f"{grams}g falls outside every configured size grade")
