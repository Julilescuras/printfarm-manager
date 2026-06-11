/**
 * TypeScript type definitions for the PrintFarm Manager.
 */

export interface PrinterState {
  id: number;
  name: string;
  model: string;
  moonraker_url: string;
  nozzle_size: number;
  extruder_type: "direct_drive" | "bowden";
  filament_tracking_mode: "manager" | "moonraker";
  fluidd_url: string | null;
  current_spool_id: number | null;
  status: PrinterStatus;
  disconnected_while_printing: boolean;
  // Safety flag: true only when a human confirmed the bed is empty. The backend
  // refuses to auto-dispatch a job while this is false, even if the status looks idle.
  bed_cleared: boolean;
  current_job_progress: number;
  hotend_temp: number;
  hotend_target: number;
  bed_temp: number;
  bed_target: number;
  current_filename: string | null;
  thumbnail_url: string | null;
  camera_url: string | null;
  total_print_time_secs: number;
  lifetime_print_seconds: number;
  eta_seconds: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export type PrinterStatus =
  | "printing"
  | "standby"
  | "requires_clearance"
  | "available"
  | "paused"
  | "error"
  | "offline";

export interface PrintJob {
  id: number;
  name: string;
  gcode_filename: string;
  gcode_original_name: string;
  compatible_models: string; // JSON string
  required_nozzle: number;
  required_material: string;
  required_color: string | null;
  required_filament_id: number | null;
  estimated_time_secs: number | null;
  estimated_weight_g: number | null;
  copies: number;
  copies_completed: number;
  priority: number;
  status: JobStatus;
  assigned_printer_id: number | null;
  started_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type JobStatus = "pending" | "paused" | "printing" | "completed" | "cancelled";

export interface MaintenanceRecord {
  id: number;
  printer_id: number;
  maintenance_type: string;
  threshold_hours: number;
  accumulated_hours: number;
  last_reset_at: string | null;
  last_reset_note: string | null;
  is_alert_active: boolean;
  custom_label: string | null;
  custom_icon: string | null;
  custom_description: string | null;
  created_at: string | null;
}

export interface MaintenanceLog {
  id: number;
  record_id: number;
  printer_id: number;
  maintenance_type: string;
  hours_at_reset: number;
  note: string | null;
  reset_at: string;
}

export interface SpoolInfo {
  id: number;
  filament: {
    id: number;
    name: string;
    material: string;
    color_hex: string;
    diameter: number;
    density: number;
    vendor: {
      id: number;
      name: string;
    };
  };
  remaining_weight: number | null;
  used_weight: number | null;
  first_used: string | null;
  last_used: string | null;
}

export interface WSMessage {
  type: "initial_state" | "printer_update" | "queue_update" | "maintenance_update";
  data: any;
}

export interface InitialState {
  printers: PrinterState[];
  active_alerts: MaintenanceRecord[];
}
