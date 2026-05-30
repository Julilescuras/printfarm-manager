import asyncio
import httpx

BACKEND = "http://localhost:8000"

async def backfill():
    async with httpx.AsyncClient() as client:
        # Get printers
        r = await client.get(f"{BACKEND}/api/printers")
        printers = r.json()
        print(f"Found {len(printers)} printers")

        # Clear existing
        await client.delete(f"{BACKEND}/api/maintenance/all")

        for p in printers:
            pid = p["id"]
            extruder = p["extruder_type"]
            
            default_records = [
                ("nozzle_change", 200.0),
                ("belt_tension", 500.0),
                ("z_screw_lube", 300.0),
                ("bed_cleaning", 50.0),
            ]
            if extruder == "bowden":
                default_records.append(("ptfe_tube", 400.0))

            for m_type, threshold in default_records:
                payload = {
                    "printer_id": pid,
                    "maintenance_type": m_type,
                    "threshold_hours": threshold
                }
                await client.post(f"{BACKEND}/api/maintenance", json=payload)
            print(f"Created records for Printer {pid}")

        # Now trigger the seed_maintenance_hours from the main seed_demo script
        print("Done!")

if __name__ == "__main__":
    asyncio.run(backfill())
