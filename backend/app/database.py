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
            ("print_history", "printer_name", "VARCHAR(100) NOT NULL DEFAULT ''"),
            ("print_history", "job_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("print_history", "material", "VARCHAR(50) NOT NULL DEFAULT ''"),
            ("print_history", "estimated_weight_g", "REAL"),
            ("print_history", "duration_secs", "INTEGER"),
            ("print_history", "result", "VARCHAR(50) NOT NULL DEFAULT 'success'"),
            ("print_jobs", "started_at", "DATETIME"),
            ("printers", "camera_url", "VARCHAR(255)"),
        ]
        for table, column, col_type in migrations:
            try:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                )
            except Exception:
                # Column already exists — skip silently
                pass
