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
from typing import Dict, List, Optional

from models import Action, Installation

MEASURE_ACTION_TYPES = {"pH Measurement", "Measurement"}

# Mirrors ActionForm.tsx:43-45's raw action-type strings (also duplicated as
# utils.ts's getTodoItems filterTypes).
FILTER_MAINTENANCE_TYPES = {"Cartridge cleaning", "Skimmer filter cleaning", "Backwash"}

PH_CYCLE_DAYS = 7
FILTER_CYCLE_DAYS = 14

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


def extract_history(actions: List[Action]) -> List[Dict]:
    """Returns one parsed entry per Measurement action, newest first."""
    measurements = [a for a in actions if a.action_type in MEASURE_ACTION_TYPES]
    sorted_actions = sorted(measurements, key=lambda a: a.date, reverse=True)
    history: List[Dict] = []
    for action in sorted_actions:
        entry = {"date": action.date, **parse_measurement_action(action)}
        history.append(entry)
    return history


def _last_matching_date(matching: List[Action]) -> Optional[date_type]:
    if not matching:
        return None
    return max(a.date for a in matching)


def compute_todo_status(actions: List[Action]) -> Dict[str, Dict]:
    """Server-side port of getNextMeasureInDays / getTodoItems in utils.ts.
    Returns days_until_due (cycle length minus days since the last matching
    action; negative once overdue) and the date of that last action, per task.
    days_until_due and last_date are both None when the task has never been
    logged for this installation (no baseline to count from)."""
    today = date_type.today()

    def status_for(matching: List[Action], cycle_days: int) -> Dict:
        last_date = _last_matching_date(matching)
        if last_date is None:
            return {"days_until_due": None, "last_date": None}
        days_since = (today - last_date).days
        return {"days_until_due": cycle_days - days_since, "last_date": last_date}

    ph_actions = [a for a in actions if a.action_type in MEASURE_ACTION_TYPES and a.qty]
    filter_actions = [a for a in actions if a.action_type in FILTER_MAINTENANCE_TYPES]

    return {
        "ph_measurement": status_for(ph_actions, PH_CYCLE_DAYS),
        "filter_maintenance": status_for(filter_actions, FILTER_CYCLE_DAYS),
    }
