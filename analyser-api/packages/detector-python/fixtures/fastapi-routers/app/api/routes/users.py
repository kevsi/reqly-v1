from fastapi import APIRouter, Depends
from app.api.deps import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
def read_me(user=Depends(get_current_user)):
    pass


@router.get("/{user_id}")
def read_user(user_id: int):
    pass