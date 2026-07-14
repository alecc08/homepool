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
from typing import Dict, List, Optional

from models import Action

MEASURE_ACTION_TYPES = {"pH Measurement", "Measurement"}

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


def extract_current_conditions(actions: List[Action]) -> Dict[str, Dict]:
    """Newest-first scan across actions; first match per field wins. Returns
    {field: {"value": float, "date": date}} for each field that has a value."""
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
                result[field] = {"value": v, "date": action.date}
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
