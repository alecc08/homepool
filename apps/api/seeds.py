from sqlmodel import Session, select

from models import Product

SEED_PRODUCTS = [
    {"name": "Chlorine", "unit_default": "g"},
    {"name": "Bromine", "unit_default": "g"},
    {"name": "Salt", "unit_default": "kg"},
    {"name": "pH+", "unit_default": "g"},
    {"name": "pH-", "unit_default": "ml"},
    {"name": "Algaecide", "unit_default": "ml"},
    {"name": "Flocculant", "unit_default": "ml"},
    {"name": "Filter cleaning", "unit_default": ""},
    {"name": "Backwash", "unit_default": ""},
    {"name": "Cartridge cleaning", "unit_default": ""},
]


def insert_seeds(session: Session) -> None:
    existing = session.exec(select(Product)).all()
    existing_names = {p.name for p in existing}
    for data in SEED_PRODUCTS:
        if data["name"] not in existing_names:
            session.add(Product(type="seed", **data))
    session.commit()
