from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    # Supabase's pooler on port 6543 runs pgbouncer in transaction mode, where one
    # server connection is shared between transactions. psycopg3 prepares statements
    # server-side by default, so a second request can land on a connection that already
    # has "_pg3_0" prepared and fail with DuplicatePreparedStatement. The failure is
    # intermittent - it needs two requests to share a connection - so it shows up under
    # concurrency (the pipeline endpoints) long before anyone reproduces it by hand.
    # prepare_threshold=None turns automatic preparation off, which is the documented
    # way to run psycopg3 through a transaction-mode pooler.
    connect_args = {"prepare_threshold": None}
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
