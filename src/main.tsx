import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// NOTE: no React.StrictMode — its dev double-mount would double-spawn PTYs.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
