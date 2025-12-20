from fastapi import FastAPI

from src.movies.views import router as movie_router
from src.search.views import router as search_router

app = FastAPI()
app.include_router(movie_router)
app.include_router(search_router)


@app.get("/")
async def index():
    return {"message": "API is running !!!"}
