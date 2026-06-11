"""
PrintFarm Manager — Database Setup
Async SQLAlchemy engine with SQLite (aiosqlite driver).
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False},  # Required for SQLite
)

# Session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that provides an async database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables on startup and run migrations for new columns."""
    from sqlalchemy import text
    async with engine.begin() as conn:
        # Enable WAL mode for better concurrency and performance
        await conn.execute(text("PRAGMA journal_mode=WAL;"))
        await conn.execute(text("PRAGMA synchronous=NORMAL;"))
        
        # Import all models so they are registered with Base
        from app.models import printer, print_job, maintenance, settings  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

        # --- Migrations: add new columns to existing tables ---
        # SQLAlchemy's create_all doesn't add columns to existing tables,
        # so we handle schema migrations here with ALTER TABLE.
        migrations = [
            ("print_jobs", "estimated_time_secs", "INTEGER"),
            ("print_jobs", "estimated_weight_g", "REAL"),
            ("print_jobs", "required_filament_id", "INTEGER"),
            ("print_history", "printer_name", "VARCHAR(100) NOT NULL DEFAULT ''"),
            ("print_history", "job_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("print_history", "material", "VARCHAR(50) NOT NULL DEFAULT ''"),
            ("print_history", "required_nozzle", "REAL"),
            ("print_history", "required_color", "VARCHAR(50)"),
            ("print_history", "required_filament_id", "INTEGER"),
            ("print_history", "estimated_weight_g", "REAL"),
            ("print_history", "duration_secs", "INTEGER"),
            ("print_history", "result", "VARCHAR(50) NOT NULL DEFAULT 'success'"),
            ("print_jobs", "started_at", "DATETIME"),
            ("printers", "camera_url", "VARCHAR(255)"),
            ("printers", "disconnected_while_printing", "INTEGER NOT NULL DEFAULT 0"),
            ("printers", "lifetime_print_seconds", "INTEGER NOT NULL DEFAULT 0"),
            ("printers", "maint_credited_secs", "INTEGER NOT NULL DEFAULT 0"),
            ("printers", "filament_tracking_mode", "VARCHAR(20) NOT NULL DEFAULT 'manager'"),
            ("printers", "bed_cleared", "INTEGER NOT NULL DEFAULT 1"),
            ("maintenance_records", "custom_label", "VARCHAR(100)"),
            ("maintenance_records", "custom_icon", "VARCHAR(20)"),
            ("maintenance_records", "custom_description", "VARCHAR(300)"),
        ]
        # Optional SQL to run ONCE, only when a column is freshly added
        # (i.e. the ALTER TABLE succeeded). Used to backfill sensible values.
        post_migration_backfill = {
            # Initialize the maintenance high-water mark to the printer's current
            # total print time, so existing printers don't get their whole last
            # print credited again the first time the monitor loop runs.
            ("printers", "maint_credited_secs"):
                "UPDATE printers SET maint_credited_secs = total_print_time_secs",
            # Any printer that isn't a clean idle state at migration time may have
            # a piece on the bed — default it to NOT cleared so the dispatcher
            # won't overprint until a human clears it.
            ("printers", "bed_cleared"):
                "UPDATE printers SET bed_cleared = 0 "
                "WHERE status IN ('printing','paused','requires_clearance','error')",
        }

        for table, column, col_type in migrations:
            try:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                )
            except Exception:
                # Column already exists — skip silently
                continue

            # ALTER succeeded → column is new → run any backfill exactly once
            backfill_sql = post_migration_backfill.get((table, column))
            if backfill_sql:
                try:
                    await conn.execute(text(backfill_sql))
                except Exception:
                    pass

        # Sync lifetime_print_seconds with maintenance records for printers where
        # it wasn't backfilled at migration time (column was added with DEFAULT 0
        # while records already had historical hours from the old system).
        # Idempotent: after the first run lifetime_print_seconds >= max accumulated.
        try:
            await conn.execute(text("""
                UPDATE printers
                SET lifetime_print_seconds = (
                    SELECT CAST(MAX(mr.accumulated_hours * 3600) AS INTEGER)
                    FROM maintenance_records mr
                    WHERE mr.printer_id = printers.id
                )
                WHERE (
                    SELECT COALESCE(MAX(mr.accumulated_hours * 3600), 0)
                    FROM maintenance_records mr
                    WHERE mr.printer_id = printers.id
                ) > lifetime_print_seconds
            """))
        except Exception:
            pass
