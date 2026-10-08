import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import check_agent_models, settings
from app.core.middleware import (
    BodySizeLimitMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.routers import (
    chat,
    criteria,
    health,
    payments,
    pipeline,
    quick_chat,
    reviews,
    screening,
    subscription,
    users,
    verification,
)
from app.routers.retrieval import router as retrieval_router

# Security events (rejected tokens, rate limiting) go to their own logger so they can be
# routed and alerted on separately from ordinary application logs.
logging.getLogger("evidenceiq.security").setLevel(logging.INFO)

# Checked before the app object exists, so a misconfigured pair of agent models stops
# the server outright instead of silently serving unverifiable results.
check_agent_models()

# The interactive docs and the schema are a complete map of the API. Useful while
# developing, and exactly what an attacker wants in production (V-10), so they are off
# there unless ENABLE_API_DOCS says otherwise.
_docs = settings.api_docs_enabled
app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

# Added innermost first: the last one added is the first to see a request. Security
# headers wrap everything, so even a 413 or 429 carries them; CORS sits outside the
# limiter so a browser can read a 429 instead of reporting a CORS failure.
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    # Exactly what the frontend sends, rather than "*".
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(subscription.router, prefix="/api")
app.include_router(payments.router, prefix="/api")
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
