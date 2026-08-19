from fastapi import APIRouter

router = APIRouter(prefix="/items", tags=["items"])


@router.get("/")
def list_items():
    pass


@router.get("/{item_id}")
def get_item(item_id: int):
    pass