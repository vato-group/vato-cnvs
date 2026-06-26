import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { startAutoUpdate } from "./lib/autoUpdate";

// NOTE: no React.StrictMode — its dev double-mount would double-spawn PTYs.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Vérifie GitHub Releases et installe toute nouvelle version automatiquement.
// Non bloquant et best-effort (ne fait rien hors contexte Tauri).
startAutoUpdate();
