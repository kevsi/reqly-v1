from fastapi import Depends, FastAPI
from pydantic import BaseModel

app = FastAPI()


class UserIn(BaseModel):
    name: str


def get_current_user():
    return {"id": 1}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/users/{user_id}")
def get_user(user_id: int):
    return {"id": user_id}


@app.post("/users", dependencies=[Depends(get_current_user)])
def create_user(user: UserIn):
    return user