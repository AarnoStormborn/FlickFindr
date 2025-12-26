from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.movies.views import router as movie_router
from src.search.views import router as search_router

app = FastAPI(
    title="FlickFindr API",
    description="Movie search API with hybrid semantic + structural search",
    version="1.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(movie_router)
app.include_router(search_router)


@app.get("/")
async def index():
    return {"message": "API is running !!!"}
