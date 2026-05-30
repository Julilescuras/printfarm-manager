"""
PrintFarm Manager — Application Configuration
Uses pydantic-settings to load from environment variables and .env file.
"""

import json
from typing import List, Optional
from pydantic import BaseModel, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PrinterConfig(BaseModel):
    """Configuration for a single printer loaded from environment."""
    name: str
    model: str
    url: str  # Moonraker URL (e.g., http://192.168.1.100:7125)
    nozzle: float = 0.4
    extruder_type: str = "direct_drive"  # direct_drive | bowden
    fluidd_url: Optional[str] = None


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/printfarm.db"

    # Spoolman
    spoolman_url: str = "http://printfarm-spoolman:8000"

    # Printers configuration (JSON string from env)
    printers_config: str = "[]"

    # G-code storage
    gcodes_path: str = "/app/gcodes"

    # Subfolder used inside each Moonraker printer's gcodes directory
    moonraker_upload_folder: str = "3Dprint-manager"

    # ─── Maintenance defaults (hours) ────────────────────────────────────────
    # Universal (all extruder types)
    default_nozzle_threshold: float = 200.0
    default_belt_threshold: float = 500.0
    default_lubrication_threshold: float = 300.0
    default_bed_leveling_threshold: float = 100.0
    default_bed_cleaning_threshold: float = 50.0
    default_extruder_gears_threshold: float = 200.0
    default_hotend_cleaning_threshold: float = 100.0
    default_z_screw_lube_threshold: float = 200.0
    default_firmware_check_threshold: float = 1000.0
    # Bowden only
    default_ptfe_tube_threshold: float = 300.0

    # WebSocket
    ws_reconnect_interval: int = 5  # seconds
    monitor_poll_interval: int = 10  # seconds

    # CORS
    cors_origins: str = "*"

    @property
    def printers(self) -> List[PrinterConfig]:
        """Parse the JSON printers config string into a list of PrinterConfig."""
        try:
            raw = json.loads(self.printers_config)
            return [PrinterConfig(**p) for p in raw]
        except (json.JSONDecodeError, TypeError):
            return []

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins string into a list."""
        if self.cors_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",")]

    def get_maintenance_defaults(self, extruder_type: str) -> List[dict]:
        """
        Returns the list of default maintenance items for a given extruder type.
        Bowden printers get all universal items PLUS ptfe_tube.
        """
        universal = [
            {"type": "nozzle_change",      "hours": self.default_nozzle_threshold},
            {"type": "belt_tension",        "hours": self.default_belt_threshold},
            {"type": "lubrication",         "hours": self.default_lubrication_threshold},
            {"type": "bed_leveling",        "hours": self.default_bed_leveling_threshold},
            {"type": "bed_cleaning",        "hours": self.default_bed_cleaning_threshold},
            {"type": "extruder_gears",      "hours": self.default_extruder_gears_threshold},
            {"type": "hotend_cleaning",     "hours": self.default_hotend_cleaning_threshold},
            {"type": "z_screw_lube",        "hours": self.default_z_screw_lube_threshold},
            {"type": "firmware_check",      "hours": self.default_firmware_check_threshold},
        ]
        if extruder_type == "bowden":
            universal.append({"type": "ptfe_tube", "hours": self.default_ptfe_tube_threshold})
        return universal


settings = Settings()
