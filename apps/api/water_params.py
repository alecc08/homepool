# apps/api/water_params.py
#
# Server-side port of the measurement-parsing logic in
# apps/web/src/utils.ts (extractMeasuredParams / RX_* regexes). That file is the
# source of truth for the `key: value` encoding written into Action.notes by
# ActionForm.tsx's toPayload; this module duplicates the parsing so external
# consumers (e.g. the Home Assistant integration) get pre-parsed fields instead
# of having to understand the internal notes-encoding scheme. If the encoding
# ever changes, both places need to change together.
import re
from datetime import date as date_type
from typing import Dict, List, Optional, Tuple

from models import Action, Installation, MaintenanceTask

MEASURE_ACTION_TYPES = {"pH Measurement", "Measurement"}

# Mirrors ActionForm.tsx:43-45's raw action-type strings (also duplicated as
# utils.ts's getTodoItems filterTypes).
FILTER_MAINTENANCE_TYPES = {"Cartridge cleaning", "Skimmer filter cleaning", "Backwash"}

# Maintenance action types writable via /v1/maintenance. Excludes "Measurement"
# (own endpoint, /v1/measurements) and "Add product" (needs a product_id lookup
# that isn't meaningful for an external caller like Home Assistant).
MAINTENANCE_ACTION_TYPES = FILTER_MAINTENANCE_TYPES | {"pH calibration", "Purge", "Water change"}

# Built-in maintenance-task defaults, keyed by installation type. Each installation
# is seeded with these on creation (see main.py); users can then enable/disable
# them, change intervals, or add custom tasks. `builtin_key` lets clients localize
# the task name (falling back to `label`). action_types[0] is what "mark done"
# logs; the full list is what counts as completing the task (reusing the existing
# action-type strings so history classification stays consistent).
DEFAULT_MAINTENANCE_TASKS: Dict[str, List[Dict]] = {
    "pool": [
        {
            "builtin_key": "ph_measurement",
            "label": "pH measurement",
            "action_types": ["Measurement", "pH Measurement"],
            "interval_days": 7,
            "icon": "mdi:test-tube",
        },
        {
            "builtin_key": "filter_maintenance",
            "label": "Filter maintenance",
            "action_types": ["Cartridge cleaning", "Skimmer filter cleaning", "Backwash"],
            "interval_days": 14,
            "icon": "mdi:air-filter",
        },
        {
            "builtin_key": "water_change",
            "label": "Water change",
            "action_types": ["Water change"],
            "interval_days": 90,
            "icon": "mdi:water-sync",
        },
    ],
    "spa": [
        {
            "builtin_key": "ph_measurement",
            "label": "pH measurement",
            "action_types": ["Measurement", "pH Measurement"],
            "interval_days": 3,
            "icon": "mdi:test-tube",
        },
        {
            "builtin_key": "filter_maintenance",
            "label": "Filter maintenance",
            "action_types": ["Cartridge cleaning", "Skimmer filter cleaning", "Backwash"],
            "interval_days": 7,
            "icon": "mdi:air-filter",
        },
        {
            "builtin_key": "water_change",
            "label": "Water change",
            "action_types": ["Water change"],
            "interval_days": 30,
            "icon": "mdi:water-sync",
        },
    ],
}


def default_maintenance_tasks(installation_type: str) -> List[Dict]:
    """Default task specs to seed a new installation of the given type with.
    Falls back to the pool set for unknown types."""
    return [dict(spec) for spec in DEFAULT_MAINTENANCE_TASKS.get(installation_type, DEFAULT_MAINTENANCE_TASKS["pool"])]

# Maps parsed-field name to the label ActionForm.tsx's toPayload writes into
# Action.notes for that field (see toPayload in ActionForm.tsx:892-905). "ph"
# is excluded: it's stored in Action.qty, not encoded into notes.
_MEASUREMENT_NOTE_LABELS = {
    "bromine": "bromine",
    "chlorine": "chlorine",
    "tac": "TAC",
    "hardness": "hardness",
    "salt": "salt",
    "stabilizer": "stabilizer",
    "cc": "combined",
    "temp": "temperature",
}

_NUM = r"(\d+(?:\.\d+)?)"
RX_PH = re.compile(r"pH\s*([\d.]+)", re.I)
RX_CHLORINE = re.compile(rf"chlorine?\s*(?:free)?\s*:?\s*{_NUM}", re.I)
RX_TAC = re.compile(rf"TAC\s*:?\s*{_NUM}", re.I)
RX_HARDNESS = re.compile(rf"hardness\s*(?:total)?\s*:?\s*{_NUM}", re.I)
RX_BROMINE = re.compile(rf"bromine\s*(?:total)?\s*:?\s*{_NUM}", re.I)
RX_SALT = re.compile(rf"salt\s*:?\s*{_NUM}", re.I)
RX_STABILIZER = re.compile(rf"(?:stabilizer|cyanuric acid|cya)\s*:?\s*{_NUM}", re.I)
RX_CC = re.compile(rf"combined\s*:?\s*{_NUM}", re.I)
RX_TEMP = re.compile(rf"(?:temperature?|\bT°)\s*:?\s*{_NUM}", re.I)

FIELDS = ["ph", "chlorine", "tac", "temp", "bromine", "hardness", "salt", "stabilizer", "cc"]


def _parse_field(field: str, action: Action) -> Optional[float]:
    if field == "ph":
        if action.action_type in MEASURE_ACTION_TYPES and action.qty:
            try:
                return float(action.qty)
            except ValueError:
                pass
        m = RX_PH.search(action.notes or "")
        return float(m.group(1)) if m else None

    rx = {
        "chlorine": RX_CHLORINE,
        "tac": RX_TAC,
        "temp": RX_TEMP,
        "bromine": RX_BROMINE,
        "hardness": RX_HARDNESS,
        "salt": RX_SALT,
        "stabilizer": RX_STABILIZER,
        "cc": RX_CC,
    }[field]
    m = rx.search(action.notes or "")
    return float(m.group(1)) if m else None


def encode_measurement_notes(fields: Dict[str, float]) -> str:
    """Inverse of the notes side of parse_measurement_action: mirrors
    ActionForm.tsx's toPayload encoding for Measurement rows, so writers (e.g.
    the Home Assistant integration) don't need to know the notes format. `ph`
    is not accepted here — callers store it in Action.qty instead."""
    parts = [
        f"{_MEASUREMENT_NOTE_LABELS[field]}: {value}"
        for field, value in fields.items()
        if field in _MEASUREMENT_NOTE_LABELS and value is not None
    ]
    return ". ".join(parts)


def parse_measurement_action(action: Action) -> Dict[str, float]:
    """Parses all measured fields present in a single action's notes/qty."""
    result: Dict[str, float] = {}
    for field in FIELDS:
        v = _parse_field(field, action)
        if v is not None:
            result[field] = v
    return result


def field_units(installation: Installation) -> Dict[str, Optional[str]]:
    """Maps each measured field to the display unit implied by the installation's
    unit settings, for consumers (e.g. Home Assistant) that need units alongside
    values."""
    temp_unit = "°F" if installation.temp_unit == "F" else "°C"
    return {
        "ph": None,
        "chlorine": installation.conc_unit,
        "bromine": installation.conc_unit,
        "cc": installation.conc_unit,
        "stabilizer": installation.conc_unit,
        "tac": installation.hardness_unit,
        "hardness": installation.hardness_unit,
        "salt": installation.salt_unit,
        "temp": temp_unit,
    }


# Inverse of dosage.py's RANGE_TO_CURRENT_FIELD — maps a parsed measurement
# field name back to its WATER_PARAMS range key. Duplicated here rather than
# imported (dosage.py already depends on this module, and it stays a tiny
# leaf mapping) — keep both in sync if either changes.
CURRENT_FIELD_TO_RANGE_KEY: Dict[str, str] = {
    "ph": "ph",
    "chlorine": "cl",
    "bromine": "br",
    "cc": "cc",
    "tac": "tac",
    "temp": "temp",
    "salt": "salt",
    "stabilizer": "cya",
    "hardness": "hardness",
}


def param_status(value: float, ideal: Optional[Tuple[float, float]], acceptable: Optional[Tuple[float, float]]) -> str:
    """ok = within ideal, warn = within acceptable but outside ideal, danger = outside acceptable
    (or no acceptable band known)."""
    if ideal and ideal[0] <= value <= ideal[1]:
        return "ok"
    if acceptable and acceptable[0] <= value <= acceptable[1]:
        return "warn"
    return "danger"


def attach_status(conditions: Dict[str, Dict], ranges: Dict[str, Dict]) -> Dict[str, Dict]:
    """Adds status ("ok"/"warn"/"danger") and ideal_min/ideal_max/acceptable_min/
    acceptable_max to each field entry in `conditions` (as returned by
    extract_current_conditions), using `ranges` (WATER_PARAMS defaults merged
    with any installation overrides — see main.py's _merge_range_overrides).
    Mutates and returns `conditions`. Fields with no matching range (e.g. a
    combo that doesn't track that param) are left without a status, so
    older/newer clients can treat its absence as "unknown" rather than a
    false negative."""
    for field, entry in conditions.items():
        range_key = CURRENT_FIELD_TO_RANGE_KEY.get(field)
        bands = ranges.get(range_key) if range_key else None
        if not bands:
            continue
        ideal = bands.get("ideal")
        acceptable = bands.get("acceptable")
        if ideal:
            entry["ideal_min"], entry["ideal_max"] = ideal
        if acceptable:
            entry["acceptable_min"], entry["acceptable_max"] = acceptable
        entry["status"] = param_status(entry["value"], ideal, acceptable)
    return conditions


def extract_current_conditions(
    actions: List[Action],
    installation: Optional[Installation] = None,
) -> Dict[str, Dict]:
    """Newest-first scan across actions; first match per field wins. Returns
    {field: {"value": float, "date": date, "unit": Optional[str]}} for each
    field that has a value. `unit` is None for every field if `installation`
    isn't provided."""
    units = field_units(installation) if installation else {}
    sorted_actions = sorted(actions, key=lambda a: a.date, reverse=True)
    result: Dict[str, Dict] = {}
    for action in sorted_actions:
        if len(result) == len(FIELDS):
            break
        for field in FIELDS:
            if field in result:
                continue
            v = _parse_field(field, action)
            if v is not None:
                result[field] = {"value": v, "date": action.date, "unit": units.get(field)}
    return result


def history_kind(action_type: str) -> str:
    """Classifies an action into the three history categories the frontend
    shows. Mirrors apps/web/src/components/HistoryPage.tsx's categoryOf:
    measurement = pH/generic Measurement, treatment = "Add product", and
    everything else (backwash, purge, calibration, …) is maintenance."""
    if action_type in MEASURE_ACTION_TYPES:
        return "measurement"
    if action_type == "Add product":
        return "treatment"
    return "maintenance"


def extract_history(
    actions: List[Action],
    product_names: Optional[Dict[int, str]] = None,
) -> List[Dict]:
    """Returns one parsed entry per action, newest first, across every action
    type (measurements, treatments, maintenance). Each entry carries `kind`,
    the raw `action_type`, a human `label` (product name for treatments, else
    the action_type), `notes`, `qty`, `unit`, plus the parsed measurement
    fields (ph, chlorine, …) for measurement rows. `product_names` maps
    product_id -> name so treatment rows resolve a readable label."""
    product_names = product_names or {}
    sorted_actions = sorted(actions, key=lambda a: a.date, reverse=True)
    history: List[Dict] = []
    for action in sorted_actions:
        kind = history_kind(action.action_type)
        if kind == "treatment":
            label = product_names.get(action.product_id) or action.action_type
        else:
            label = action.action_type
        entry = {
            "date": action.date,
            "kind": kind,
            "action_type": action.action_type,
            "label": label,
            "notes": action.notes or "",
            "qty": action.qty or None,
            "unit": action.unit or None,
        }
        if kind == "measurement":
            entry.update(parse_measurement_action(action))
        history.append(entry)
    return history


def _last_matching_date(matching: List[Action]) -> Optional[date_type]:
    if not matching:
        return None
    return max(a.date for a in matching)


def maintenance_task_key(task: MaintenanceTask) -> str:
    """Stable client-facing key for a task: its builtin_key, or custom_<id>."""
    return task.builtin_key or f"custom_{task.id}"


def compute_task_status(tasks: List[MaintenanceTask], actions: List[Action]) -> List[Dict]:
    """Per-task maintenance status. For each task, finds the most recent action
    whose action_type is one of the task's action_types and derives
    days_until_due (interval_days minus days since that action; negative once
    overdue). days_until_due and last_date are both None when the task has never
    been logged for this installation (no baseline to count from). Returns tasks
    in (sort_order, id) order."""
    today = date_type.today()
    ordered = sorted(tasks, key=lambda t: (t.sort_order, t.id or 0))
    result: List[Dict] = []
    for task in ordered:
        matching = [a for a in actions if a.action_type in (task.action_types or [])]
        last_date = _last_matching_date(matching)
        if last_date is None:
            days_until_due = None
        else:
            days_until_due = task.interval_days - (today - last_date).days
        result.append(
            {
                "id": task.id,
                "key": maintenance_task_key(task),
                "builtin_key": task.builtin_key,
                "label": task.label,
                "icon": task.icon,
                "action_types": list(task.action_types or []),
                "interval_days": task.interval_days,
                "enabled": task.enabled,
                "sort_order": task.sort_order,
                "days_until_due": days_until_due,
                "last_date": last_date,
            }
        )
    return result
