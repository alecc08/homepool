"""Constants for the Pooly integration."""
from homeassistant.components.sensor import SensorDeviceClass, SensorStateClass
from homeassistant.const import CONF_API_KEY, CONF_URL  # noqa: F401

DOMAIN = "pooly"

CONF_BASE_URL = CONF_URL

DEFAULT_SCAN_INTERVAL_MINUTES = 5

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
