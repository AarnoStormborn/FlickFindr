from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str = "localhost"
    db_port: str = "5432"
    db_name: str
    db_user: str
    db_password: str
    REDIS_URL: str = "redis://localhost:6379"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"


settings = Settings()

broker_url = settings.REDIS_URL
result_backend = settings.REDIS_URL
