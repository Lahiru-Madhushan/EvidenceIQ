from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import check_agent_models, settings
from app.routers import (
    chat,
    criteria,
    health,
    pipeline,
    quick_chat,
    reviews,
    screening,
    users,
    verification,
)
from app.routers.retrieval import router as retrieval_router

# Checked before the app object exists, so a misconfigured pair of agent models stops
# the server outright instead of silently serving unverifiable results.
check_agent_models()

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
app.include_router(pipeline.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(quick_chat.router, prefix="/api")
app.include_router(retrieval_router)


@app.get("/")
def root():
    return {"message": f"{settings.app_name} API"}