# API V1 (draft)

## Entities
- User: id, username, created_at
- Product: id, name, type (seed|custom), unit_default
- Action: id, user_id, date, action_type, product_id, qty, unit, notes, created_at

## Endpoints
- POST /auth/login  { username } -> { token, user }
- GET /me -> { user }
- GET /products -> [product]
- POST /products -> { name, unit_default } -> product
- GET /actions?from=YYYY-MM-DD&to=YYYY-MM-DD
- POST /actions
- DELETE /actions/:id

## Notes
- Token per device (bearer)
- All endpoints protected except /auth/login
- Seed products: chlorine, bromine, salt, pH+, pH-, algaecide, flocculant, filter cleaning, backwash, cartridge cleaning
