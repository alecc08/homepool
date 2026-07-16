<div align="center">

<img src="docs/pooly-icon.svg" alt="Pooly" width="80" height="80">

# Pooly

**Pool & spa maintenance tracker — self-hosted**

*(the app itself supports English and French via an in-app language toggle — this documentation is English-only)*

[![Version](https://img.shields.io/badge/version-1.0.0-38bdf8?style=flat-square)](https://github.com/alecc08/pooly/releases)
[![Licence](https://img.shields.io/badge/licence-MIT-10b981?style=flat-square)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-compose-0ea5e9?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev)

### ☕ Support

If Pooly is useful to you, consider buying me a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/T6T61NJXQS)

</div>

---

## 🙏 About this fork

Pooly was created by [aurel-f](https://github.com/aurel-f) — go check out the
[original repository](https://github.com/aurel-f/pooly). This fork exists to move a bit
faster and rewrite the documentation in English; the underlying app and its features trace
directly back to aurel-f's work.

If you like this project, please star and contribute to the **original repo** — that's
where it all started, and that's the best way to support the person who built it.

### 🚧 What this fork has added

On top of the original app, this fork has added:

- **Home Assistant integration** — a custom component (installable via HACS) that exposes your water parameters as sensors, plus a public API for it
- **Salt pool mode** — dedicated salt water generator (SWG) support with combined chlorine tracking and pool volume
- **Per-installation units** — configurable temperature, salt, concentration and hardness units per pool/spa
- **Full English localization** — the app UI, config flow, and this documentation were rewritten/translated to English, with a FR/EN language toggle in-app
- **Multi-installation management** — ability to delete a pool/spa installation from the sidebar
- **Configurable ideal ranges** — override any water-parameter range (pH, chlorine, salt, CYA, etc.) via environment variables instead of touching code
- **CI** — a GitHub Actions workflow that lints, builds and tests the web app and API on every PR

---

## Table of contents
- [Overview](#-overview)
- [Features](#-features)
- [Screenshots](#-screenshots)
- [Quick start](#-quick-start)
- [Configuration](#-configuration)
- [Home Assistant Integration](#-home-assistant-integration)
- [Tech stack](#-tech-stack)
- [Contributing](#-contributing)
- [Support](#-support)
- [License](#-license)

---

### 🌊 Overview

Pooly is a **self-hosted** web application to track the maintenance of your pools and spas. Log your water measurements, treatments and maintenance tasks from a clean dashboard — your data stays on your own server.

Designed for owners who want full control without complexity: one Docker command and you're up and running.

---

### ✨ Features

- **Full dashboard** — KPIs, real-time water parameters, visual water quality indicator
- **AquaChek test strip input** — interactive color chart for pH, Alkalinity, Bromine, Chlorine and Hardness
- **Digital device input** — decimal inputs with range validation
- **Multi-installation** — manage multiple pools and spas with adapted reference ranges
- **Bromine, chlorine or salt** — differentiated ideal ranges per sanitizer, including salt water generator (SWG) pools, with free-chlorine targets set for the higher CYA a salt system runs at
- **Full history** — monthly timeline, type filters, full-text search
- **Measurements page** — track parameter trends over time
- **Dark mode** — light, dark or automatic theme (system preference)
- **PWA** — installable on mobile, bottom navigation, bottom sheet modal
- **Self-hosted & private** — no third-party cloud, no tracking, your data stays yours

---

### 📸 Screenshots

<div align="center">

| Dashboard — Light mode | Dashboard — Dark mode |
|---|---|
| ![Dashboard light](docs/screenshots/dashboard-light.png) | ![Dashboard dark](docs/screenshots/dashboard-dark.png) |

| Measurements | History |
|---|---|
| ![Measurements](docs/screenshots/measurements-light.png) | ![History](docs/screenshots/history-light.png) |

| New entry — Maintenance | New entry — AquaChek strip |
|---|---|
| ![Maintenance modal](docs/screenshots/modal-entry.png) | ![Strip modal](docs/screenshots/modal-strip.png) |

</div>

---

### 🚀 Quick start

**Requirements**: Docker and Docker Compose installed on your machine.

```bash
# 1. Clone the repository
git clone https://github.com/alecc08/pooly.git
cd pooly

# 2. Set up environment
cp .env.example .env
nano .env  # Set your passwords and secrets

# 3. Start Pooly
docker compose up -d

# 4. Open in your browser
open http://localhost:8090
```

The app is available at `http://localhost:8090`. Create your account on first login.

---

### ⚙️ Configuration

Copy `.env.example` to `.env` and adjust the values:

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password | — |
| `SESSION_SECRET` | Session secret key | — |
| `APP_BASE_URL` | Public app URL | `http://localhost:8090` |
| `ALLOWED_ORIGINS` | Allowed CORS origins | `http://localhost:8090` |
| `DEBUG` | Debug mode (logs reset links) | `false` |

> ⚠️ **Never commit your `.env` file**. It is already in `.gitignore`.

#### Customizing ideal water-parameter ranges

Every ideal/acceptable range shown in the app (pH, free chlorine, salt, CYA, alkalinity, hardness, temperature...) has sensible built-in defaults per installation type and sanitizer — including a salt water generator (SWG) profile with a higher CYA target (60-80 ppm) and a matching free-chlorine band, following [PoolMath](https://www.troublefreepool.com/blog/poolmath/) / Trouble Free Pool guidance. If your setup runs differently, open an installation's edit modal → **Water Chemistry Targets** tab to customize any band per installation, right from the UI — no env vars or restarts required.

> ⚠️ **Upgrading from an older version?** The `RANGE_<TYPE>_<SANITIZER>_<PARAM>_{IDEAL,ACCEPTABLE}_{MIN,MAX}` env var mechanism has been removed in favor of the per-installation UI above. If you were relying on `RANGE_*` env vars, re-apply your preferred ranges per-installation via the UI after upgrading — the env vars are now ignored.

---

### 🏠 Home Assistant Integration

Pooly's water measurements can be pulled into Home Assistant as sensors.

1. **Install via HACS**
   Settings → HACS → custom repositories (⋮ menu) → add repository URL `https://github.com/alecc08/pooly`, category **Integration** → find "Pooly" in HACS → Install.

2. **Add the integration**
   Settings → Devices & Services → Add Integration → search for "Pooly".

3. **Configure**
   - **Base URL**: your Pooly server URL. If you're running behind the bundled nginx/reverse-proxy setup, this **must include the `/api` path** — e.g. `https://your-domain/api`, not just `https://your-domain`. Using the domain without `/api` will result in a "failed to connect to the Pooly server" error.
   - **API Key**: generate one from Settings → API Key in the Pooly web app.

4. **Result**
   Once added, you'll get a Sensors card with your installation's water parameters:

   ![Home Assistant sensors](docs/screenshots/ha-sensors.png)

5. **Display on a dashboard (optional)**
   Pooly's integration only exposes the raw sensor entities — for a nicer pool-specific dashboard widget, pair it with the [Pool Monitor Card](https://github.com/wilsto/pool-monitor-card) (installable via HACS as a frontend repository). Use the Pooly sensors as the card's data source to get a purpose-built pool/spa display.

---

### 🛠 Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS |
| Backend | FastAPI, SQLModel, Python 3.12 |
| Database | PostgreSQL 16 |
| Auth | Cookie sessions (httpOnly, same_site=strict) |
| Deployment | Docker Compose |
| Typography | Sora + IBM Plex Mono |

---

### 🤝 Contributing

Contributions are welcome! Here's how to get involved:

```bash
# Fork the repo, then:
git clone https://github.com/alecc08/pooly.git
cd pooly
git checkout -b feature/my-feature

# Make your changes, then:
git commit -m "feat: describe the feature"
git push origin feature/my-feature
# Open a Pull Request
```

**Appreciated contribution types:**
- 🐛 Bug fixes
- ✨ New features
- 🌍 Translations
- 📸 Screenshots and demos
- 📖 Documentation improvements

Check the [open issues](https://github.com/alecc08/pooly/issues) to find something to work on.

---

### 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  <sub>Made with ♥ · Self-hosted · Open source</sub>
</div>
</content>
