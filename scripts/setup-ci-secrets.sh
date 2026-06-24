#!/usr/bin/env bash
# Peuple les secrets GitHub Actions requis par .github/workflows/build.yml.
# Réutilise les credentials de notarisation Apple du projet vato-ide (mêmes noms).
#
# GitHub ne permet PAS de lire la valeur d'un secret existant : on ne peut donc
# pas copier ceux de vato-ide automatiquement. Ce script (re)pousse les valeurs
# à partir du matériel source — à lancer de préférence SUR LE MAC, où vivent le
# certificat .p12 et le mot de passe app-specific.
#
# Pré-requis : `gh auth login` avec le scope `repo` (et `admin:org` si --org).
#
# Usage :
#   bash scripts/setup-ci-secrets.sh            # secrets repo-level sur vato-cnvs (défaut)
#   bash scripts/setup-ci-secrets.sh --org      # secrets org-level vato-group (partagés, admin:org requis)
#
# Valeurs sensibles : passées via variables d'env OU demandées interactivement.
#   APPLE_CERTIFICATE_P12        chemin du .p12 "Developer ID Application" (sera base64-encodé)
#   APPLE_CERTIFICATE_PASSWORD   mot de passe du .p12
#   APPLE_ID                     Apple ID (email du compte développeur)
#   APPLE_PASSWORD               mot de passe app-specific (https://appleid.apple.com → Sécurité)
#
# Exporter le .p12 depuis le trousseau macOS :
#   Trousseau d'accès → catégorie "Mes certificats" → clic droit sur
#   "Developer ID Application: Noah d'hondt (22NT733Y82)" → Exporter →
#   format .p12 → choisir un mot de passe (= APPLE_CERTIFICATE_PASSWORD).

set -euo pipefail

REPO="vato-group/vato-cnvs"
ORG="vato-group"
ORG_MODE=0
[ "${1:-}" = "--org" ] && ORG_MODE=1

# ── Valeurs non secrètes (identiques à vato-ide / tauri.conf.json) ─────────
APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Noah d'hondt (22NT733Y82)}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-22NT733Y82}"

set_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then echo "  (skip $name — valeur vide)"; return; fi
  if [ "$ORG_MODE" = "1" ]; then
    printf '%s' "$value" | gh secret set "$name" --org "$ORG" --visibility all
  else
    printf '%s' "$value" | gh secret set "$name" -R "$REPO"
  fi
  echo "  ✓ $name"
}

prompt() { # prompt VARNAME "label" [silent]
  local __var="$1" label="$2" silent="${3:-}" val
  [ -n "${!__var:-}" ] && return
  if [ "$silent" = "silent" ]; then read -rsp "$label : " val; echo; else read -rp "$label : " val; fi
  printf -v "$__var" '%s' "$val"
}

# ── Certificat .p12 → base64 (une seule ligne) ────────────────────────────
APPLE_CERTIFICATE="${APPLE_CERTIFICATE:-}"
if [ -z "$APPLE_CERTIFICATE" ]; then
  prompt APPLE_CERTIFICATE_P12 "Chemin du .p12 Developer ID Application"
  APPLE_CERTIFICATE="$(base64 < "${APPLE_CERTIFICATE_P12}" | tr -d '\n')"
fi
prompt APPLE_CERTIFICATE_PASSWORD "Mot de passe du .p12" silent
prompt APPLE_ID "Apple ID (email)"
prompt APPLE_PASSWORD "Mot de passe app-specific" silent

if [ "$ORG_MODE" = "1" ]; then
  echo "→ écriture des secrets ORG ($ORG, visibilité: tous les repos)"
else
  echo "→ écriture des secrets REPO ($REPO)"
fi

set_secret APPLE_CERTIFICATE          "$APPLE_CERTIFICATE"
set_secret APPLE_CERTIFICATE_PASSWORD "$APPLE_CERTIFICATE_PASSWORD"
set_secret APPLE_SIGNING_IDENTITY     "$APPLE_SIGNING_IDENTITY"
set_secret APPLE_ID                   "$APPLE_ID"
set_secret APPLE_PASSWORD             "$APPLE_PASSWORD"
set_secret APPLE_TEAM_ID              "$APPLE_TEAM_ID"

echo "✓ Secrets en place. Prochain push sur main/master déclenchera le build signé + notarisé."
