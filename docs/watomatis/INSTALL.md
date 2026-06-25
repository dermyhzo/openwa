# Watomatis: Installation Guide

Watomatis is a self-hosted AI WhatsApp customer-service agent. This guide gets you running in one command.

---

## Prerequisites

- **macOS or Linux** (Windows: use WSL2, then follow the Linux steps inside it).
- **Docker Desktop** (macOS / Windows) or **Docker Engine + Compose plugin** (Linux).
  - Download: https://www.docker.com/products/docker-desktop/
  - Linux install: https://docs.docker.com/engine/install/
- **Git** (usually pre-installed on macOS; on Linux: `sudo apt install git` or equivalent).
- Internet access to pull the Docker base image on first run (a few hundred MB, one time only).

No Node.js, Python, or other runtimes needed on the host.

---

## Install (one command)

Open a Terminal and run:

```bash
git clone https://github.com/dermyhzo/openwa ~/watomatis && bash ~/watomatis/install.sh
```

Or, if you already have the repository cloned, run from inside it:

```bash
bash install.sh
```

That's it. The script will:

1. Verify Docker is installed and running.
2. Create a `.env` file from the example template and generate a secure random secret.
3. Build the Docker image and start the container.
4. Poll the health endpoint and print the dashboard URL when ready.

First build takes 3-10 minutes depending on your internet connection. Subsequent runs are fast (image is cached).

---

## What to expect

```
[info]  === Watomatis installer ===
[ok]    Docker OK (docker compose)
[info]  Created .env from .env.example
[ok]    Generated WATOMATIS_SECRET and wrote it to .env
[info]  Starting Watomatis (this builds the image on first run, takes a few minutes)...
[ok]    Containers started
[info]  Waiting for http://localhost:2785/api/health/ready ...
[ok]    Watomatis is up and healthy!
[ok]    ============================================================
[ok]      Watomatis is running at http://localhost:2785
[ok]    ============================================================
```

---

## Open the dashboard

Navigate to: **http://localhost:2785**

First-time setup steps in the dashboard:

1. **Sessions** - click "New Session", then scan the QR code with your WhatsApp mobile app (three dots menu, "Linked Devices", "Link a Device").
2. **AI Agent** - enter your LLM API key (APImart or OpenRouter), then click "Learn" to upload your chat history or pull it from a connected session.
3. **License** - activate your subscription (requires Duitku credentials configured in `.env` by the operator).

---

## Update

To pull the latest code and rebuild:

```bash
cd ~/watomatis        # or wherever the repo lives
git pull
docker compose -f docker-compose.dev.yml up -d --build
```

---

## Stop

```bash
docker compose -f docker-compose.dev.yml down
```

Your data (sessions, database, media) lives in `./data/` and is preserved across stop/start cycles.

---

## Troubleshooting

**"Docker is not running"**
: Start Docker Desktop from your Applications folder (macOS) or run `sudo systemctl start docker` (Linux).

**First boot takes more than 10 minutes / QR never appears**
: Add this line to your `.env` to pin a known-good WhatsApp Web version:
```
WWEBJS_WEB_VERSION=2.3000.1023204257
```
Then restart: `docker compose -f docker-compose.dev.yml up -d`.

**Container exits immediately**
: Check logs: `docker compose -f docker-compose.dev.yml logs --tail=50`

**Port 2785 already in use**
: Another process is on that port. Find it with `lsof -i :2785` and stop it, or change `API_PORT` in `.env` (and update the `ports:` line in `docker-compose.dev.yml` to match).

**WhatsApp session drops after a container rebuild**
: This is normal. Go to Sessions and scan the QR again.

**"Health check timed out"**
: The container may still be starting. Wait another minute, then open http://localhost:2785. If still down: `docker compose -f docker-compose.dev.yml logs -f`

---

## Install via AI agent

If you prefer to let an AI coding agent (Claude Code, Cursor, Windsurf, etc.) handle the installation, paste the following prompt into it:

```
I need to install and run Watomatis (a self-hosted AI WhatsApp customer-service agent).

Steps:
1. Clone the repository to ~/watomatis:
   git clone https://github.com/dermyhzo/openwa ~/watomatis

2. Run the installer:
   bash ~/watomatis/install.sh

3. Verify the app is healthy:
   curl http://localhost:2785/api/health/ready

4. Open http://localhost:2785 in the browser and confirm the dashboard loads.

Prerequisites: Docker Desktop must be installed and running. If the health check
fails, check logs with:
   docker compose -f ~/watomatis/docker-compose.dev.yml logs --tail=50

Report back: whether the container is up, what the health endpoint returned, and
the URL to open the dashboard.
```

---

## File locations

| Path | Purpose |
|---|---|
| `.env` | Your configuration (auto-created by installer, never committed) |
| `.env.example` | Template showing all available options |
| `data/` | Persistent data: sessions, SQLite DB, media |
| `docker-compose.dev.yml` | The compose file used by install.sh |

---

## Windows (WSL2)

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) with the WSL2 backend enabled.
2. Open a WSL2 terminal (Ubuntu or Debian recommended).
3. Follow the standard Linux steps above.
4. Access the dashboard from Windows at **http://localhost:2785** (Docker Desktop forwards the port automatically).
