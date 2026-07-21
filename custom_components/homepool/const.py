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

# todo task key -> (icon, name), same shape/purpose as FIELD_META/FIELD_NAMES.
TODO_META = {
    "ph_measurement": ("mdi:calendar-clock", "Days Until pH Measurement Due"),
    "filter_maintenance": ("mdi:calendar-clock", "Days Until Filter Maintenance Due"),
}

# Maintenance action_type -> (icon, name), mirrors MAINTENANCE_ACTION_TYPES on the
# homepool public API (apps/api/water_params.py). Kept as a literal set here since the
# HA integration has no dependency on the api package.
BUTTON_META = {
    "Cartridge cleaning": ("mdi:air-filter", "Log Cartridge Cleaning"),
    "Skimmer filter cleaning": ("mdi:filter-outline", "Log Skimmer Filter Cleaning"),
    "Backwash": ("mdi:valve", "Log Backwash"),
    "pH calibration": ("mdi:tune", "Log pH Calibration"),
    "Purge": ("mdi:water-pump", "Log Purge"),
    "Water change": ("mdi:water-sync", "Log Water Change"),
}

MAINTENANCE_ACTION_TYPES = list(BUTTON_META)
