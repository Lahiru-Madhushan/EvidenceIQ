from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import health, users, verification, screening, criteria
from app.routers.retrieval import router as retrieval_router

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(verification.router, prefix="/api")
app.include_router(screening.router, prefix="/api")
app.include_router(criteria.router, prefix="/api")
app.include_router(retrieval_router)


@app.get("/")
def root():
    return {"message": f"{settings.app_name} API"}