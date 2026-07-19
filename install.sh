#!/usr/bin/env bash
# Watomatis installer
# Usage:  bash install.sh
#         bash <(curl -fsSL https://raw.githubusercontent.com/.../install.sh)
#
# Idempotent: safe to re-run. Never overwrites an existing .env.

set -euo pipefail

REPO_URL="https://github.com/dermyhzo/openwa"
APP_PORT=2785
HEALTH_URL="http://localhost:${APP_PORT}/api/health/ready"
COMPOSE_FILE="docker-compose.dev.yml"
WAIT_SECONDS=120   # max seconds to wait for healthy

# ── helpers ────────────────────────────────────────────────────────────────────
info()    { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
warn()    { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
die()     { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── locate the repo root ───────────────────────────────────────────────────────
# When run as `bash install.sh` from inside the repo, SCRIPT_DIR is the repo.
# When piped via curl (no file on disk), we clone the repo first.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

if [[ -f "${SCRIPT_DIR}/${COMPOSE_FILE}" ]]; then
  REPO_DIR="$SCRIPT_DIR"
else
  info "Cloning Watomatis repository..."
  if ! command -v git &>/dev/null; then
    die "git is not installed. Install it and re-run."
  fi
  REPO_DIR="${HOME}/watomatis"
  if [[ -d "$REPO_DIR/.git" ]]; then
    info "Repo already cloned at ${REPO_DIR}; pulling latest..."
    git -C "$REPO_DIR" pull --ff-only
  else
    git clone "$REPO_URL" "$REPO_DIR"
  fi
fi

cd "$REPO_DIR"

# ── 1. check Docker ────────────────────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    printf '\n'
    warn "Docker is not installed."
    printf '  macOS / Windows: install Docker Desktop from https://www.docker.com/products/docker-desktop/\n'
    printf '  Linux:           install Docker Engine via https://docs.docker.com/engine/install/\n\n'
    die "Please install Docker and re-run install.sh."
  fi

  # docker compose (plugin) or docker-compose (standalone)
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    printf '\n'
    warn "Docker Compose is not available."
    printf '  macOS / Windows: update Docker Desktop (Compose is included since v3.x).\n'
    printf '  Linux:           install the Compose plugin: https://docs.docker.com/compose/install/\n\n'
    die "Please install Docker Compose and re-run install.sh."
  fi

  # make sure the Docker daemon is actually running
  if ! docker info &>/dev/null 2>&1; then
    die "Docker is installed but the daemon is not running. Start Docker Desktop (or 'sudo systemctl start docker') and re-run."
  fi

  command -v curl &>/dev/null || die "curl is not installed. Install it and re-run."

  success "Docker OK (${COMPOSE_CMD})"
}

# ── 2. ensure .env exists ──────────────────────────────────────────────────────
setup_env() {
  if [[ -f ".env" ]]; then
    info ".env already exists, skipping (not overwritten)."
    return
  fi

  if [[ ! -f ".env.example" ]]; then
    die ".env.example not found in ${REPO_DIR}. Repository may be incomplete."
  fi

  cp .env.example .env
  info "Created .env from .env.example"

  # generate a strong random WATOMATIS_SECRET
  if command -v openssl &>/dev/null; then
    SECRET="$(openssl rand -hex 32)"
  else
    # fallback: /dev/urandom via od
    SECRET="$(od -A n -t x1 -N 32 /dev/urandom | tr -d ' \n')"
  fi

  # replace the placeholder value in .env (handles both quoted and bare forms)
  if grep -q 'WATOMATIS_SECRET' .env; then
    # sed -i differs between macOS (-i '') and Linux (-i)
    if sed --version &>/dev/null 2>&1; then
      sed -i "s|^WATOMATIS_SECRET=.*|WATOMATIS_SECRET=${SECRET}|" .env
    else
      sed -i '' "s|^WATOMATIS_SECRET=.*|WATOMATIS_SECRET=${SECRET}|" .env
    fi
  else
    printf '\nWATOMATIS_SECRET=%s\n' "$SECRET" >> .env
  fi

  success "Generated WATOMATIS_SECRET and wrote it to .env"
}

# ── 3. start containers ────────────────────────────────────────────────────────
start_containers() {
  info "Starting Watomatis (this builds the image on first run, takes a few minutes)..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" up -d --build
  success "Containers started"
}

# ── 4. wait for healthy ────────────────────────────────────────────────────────
wait_healthy() {
  info "Waiting for ${HEALTH_URL} ..."
  local elapsed=0
  local interval=5
  while true; do
    if curl -sf "$HEALTH_URL" &>/dev/null; then
      success "Watomatis is up and healthy!"
      return 0
    fi
    if (( elapsed >= WAIT_SECONDS )); then
      warn "Timed out after ${WAIT_SECONDS}s. The app may still be starting."
      warn "Check logs with: ${COMPOSE_CMD} -f ${COMPOSE_FILE} logs -f"
      return 1
    fi
    printf '  ... still starting (%ds elapsed)\n' "$elapsed"
    sleep "$interval"
    (( elapsed += interval ))
  done
}

# ── 5. show the dashboard login key ───────────────────────────────────────────
# The admin API key is generated inside the container on first boot and written
# to data/.api-key. Without it the buyer cannot log in, so print it loudly here.
show_login_key() {
  local key_file="data/.api-key"
  local waited=0
  while [[ ! -s "$key_file" && $waited -lt 30 ]]; do
    sleep 2
    (( waited += 2 ))
  done
  if [[ -s "$key_file" ]]; then
    LOGIN_KEY="$(cat "$key_file" 2>/dev/null || true)"
  fi
  if [[ -z "${LOGIN_KEY:-}" ]]; then
    # fallback: the container logs print it on first boot
    LOGIN_KEY="$($COMPOSE_CMD -f "$COMPOSE_FILE" logs 2>/dev/null | grep -oE 'owa_k1_[a-f0-9]+' | tail -1 || true)"
  fi
}

# ── main ───────────────────────────────────────────────────────────────────────
printf '\n'
info "=== Watomatis installer ==="
printf '    Repo: %s\n\n' "$REPO_DIR"

check_docker
setup_env
start_containers
wait_healthy
show_login_key

printf '\n'
success "============================================================"
success "  Watomatis is running at http://localhost:${APP_PORT}"
success "============================================================"
printf '\n'
if [[ -n "${LOGIN_KEY:-}" ]]; then
  printf '  \033[1;33mAPI KEY LOGIN DASHBOARD kamu (SIMPAN INI):\033[0m\n'
  printf '  \033[1m%s\033[0m\n' "$LOGIN_KEY"
  printf '  (juga tersimpan di file %s/data/.api-key)\n' "$REPO_DIR"
else
  warn "API key login belum terbaca. Lihat dengan: cat ${REPO_DIR}/data/.api-key"
fi
printf '\n'
printf '  Langkah berikutnya:\n'
printf '    1. Buka http://localhost:%s di browser, login pakai API key di atas\n' "$APP_PORT"
printf '    2. Menu License: tempel kode lisensi (WTM1...) yang dikirim ke WhatsApp kamu, klik Aktifkan\n'
printf '    3. Menu Sessions: "New Session", scan QR pakai WhatsApp nomor CS kamu\n'
printf '    4. Menu AI Agent: isi API key AI kamu (apimart.ai/openrouter), lalu ikuti panduan belajar\n'
printf '\n'
printf '  Stop:   %s -f %s down\n' "$COMPOSE_CMD" "$COMPOSE_FILE"
printf '  Update: git pull && %s -f %s up -d --build\n' "$COMPOSE_CMD" "$COMPOSE_FILE"
printf '\n'
