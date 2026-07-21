"""Constants for the homepool integration."""
from homeassistant.components.sensor import SensorDeviceClass, SensorStateClass
from homeassistant.const import CONF_API_KEY, CONF_URL  # noqa: F401

DOMAIN = "homepool"

CONF_BASE_URL = CONF_URL

DEFAULT_SCAN_INTERVAL_MINUTES = 5

# How many recent history entries the coordinator pulls per installation and
# stashes on the history sensor's `entries` attribute for the frontend table
# card. Kept modest (and null fields stripped in the coordinator) so the
# attribute stays well under HA's ~16 KB soft cap. This is the hard ceiling the
# history card's own `max_items` slices down from.
HISTORY_LIMIT = 50

# field -> (device_class, state_class, icon)
# Pool-chemistry fields have no matching HA device class; the display unit comes
# from the API response instead, so device_class is left None for those.
FIELD_META = {
    "ph": (SensorDeviceClass.PH, SensorStateClass.MEASUREMENT, "mdi:ph"),
    "chlorine": (None, SensorStateClass.MEASUREMENT, "mdi:flask-outline"),
    "bromine": (None, SensorStateClass.MEASUREMENT, "mdi:flask-outline"),
    "tac": (None, SensorStateClass.MEASUREMENT, "mdi:flask-outline"),
    "hardness": (None, SensorStateClass.MEASUREMENT, "mdi:water-opacity"),
    "salt": (None, SensorStateClass.MEASUREMENT, "mdi:shaker-outline"),
    "stabilizer": (None, SensorStateClass.MEASUREMENT, "mdi:flask-outline"),
    "cc": (None, SensorStateClass.MEASUREMENT, "mdi:flask-outline"),
    "temp": (SensorDeviceClass.TEMPERATURE, SensorStateClass.MEASUREMENT, "mdi:thermometer"),
}

FIELD_NAMES = {
    "ph": "pH",
    "chlorine": "Chlorine",
    "bromine": "Bromine",
    "tac": "TAC",
    "hardness": "Hardness",
    "salt": "Salt",
    "stabilizer": "Stabilizer (CYA)",
    "cc": "Combined Chlorine",
    "temp": "Temperature",
}

# Maintenance tasks are no longer a fixed set: the todo "days until due" sensors
# (sensor.py) and "mark done" buttons (button.py) are created dynamically from
# the API's /v1/todo task list, deriving their name/icon from each task payload.
