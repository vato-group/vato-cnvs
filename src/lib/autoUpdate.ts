// Auto-update : vérifie GitHub Releases au démarrage et installe la nouvelle
// version « tout seul ». Le plugin updater compare la version courante au
// `latest.json` publié (endpoint dans tauri.conf.json), télécharge le binaire
// signé, vérifie la signature minisign (pubkey embarquée), l'installe puis
// relance l'app.
//
// Tout est best-effort : hors contexte Tauri (dev navigateur pur) ou en cas
// d'erreur réseau, on log et on continue sans jamais bloquer le lancement.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

let started = false;

/** Petit log best-effort vers le fichier de debug Rust (ignore les erreurs). */
async function log(line: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_log", { line: `[updater] ${line}` });
  } catch {
    /* hors Tauri ou commande absente : on s'en moque */
  }
  // Toujours visible aussi dans la console du webview.
  console.info(`[updater] ${line}`);
}

/**
 * Télécharge + installe une mise à jour détectée, en suivant la progression,
 * puis relance l'application.
 */
async function downloadInstallRelaunch(update: Update): Promise<void> {
  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        log(`téléchargement démarré (${contentLength} octets)`);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        break;
      case "Finished":
        log("téléchargement terminé, installation…");
        break;
    }
  });

  await log(`v${update.version} installée — relance de l'application`);
  // Relance pour appliquer la nouvelle version (NSIS/MSI ont déjà remplacé les
  // binaires). Sur Windows l'installeur peut déjà avoir relancé : relaunch()
  // reste sans danger.
  await relaunch();
}

/**
 * À appeler une fois au démarrage. Vérifie en arrière-plan s'il existe une
 * nouvelle release ; si oui, l'installe automatiquement et relance.
 *
 * Idempotent (un seul check par session) et non bloquant.
 */
export function startAutoUpdate(): void {
  if (started) return;
  started = true;

  // Laisse l'UI démarrer avant de taper le réseau.
  setTimeout(() => {
    void runCheck();
  }, 3000);
}

async function runCheck(): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      await log("aucune mise à jour disponible");
      return;
    }
    await log(`mise à jour disponible : v${update.version} (courante v${update.currentVersion})`);
    await downloadInstallRelaunch(update);
  } catch (err) {
    // Hors Tauri, pas de réseau, release sans latest.json, etc. : non fatal.
    await log(`vérification ignorée : ${String(err)}`);
  }
}
