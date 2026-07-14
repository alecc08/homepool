# Stack V1 (proposal)

## Frontend
- Vite + React + TypeScript
- PWA: manifest + minimal service worker (vite-plugin-pwa)
- Styling: CSS (global file) + variables

## Backend
- FastAPI (Python) + PostgreSQL
- ORM: SQLModel or SQLAlchemy

## Auth V1
- Unique username + token per device (bearer token)
- No email / no password

## Rationale
- Fast iteration
- Stable stack for PWA
- Clear API for future Home Assistant integration
