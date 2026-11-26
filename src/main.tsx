import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/liquid-glass.css";
import App from "./App";
import { LyricsOverlay } from "./components/LyricsOverlay";

const isLyricsOverlay = new URLSearchParams(window.location.search).get("mode") === "lyrics";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isLyricsOverlay ? <LyricsOverlay /> : <App />}
  </React.StrictMode>
);
