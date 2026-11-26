import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/liquid-glass.css";
import App from "./App";
import { LyricsOverlay } from "./components/LyricsOverlay";
import { MiniPlayerWindow } from "./components/MiniPlayerWindow";

const mode = new URLSearchParams(window.location.search).get("mode");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {mode === "lyrics" ? (
      <LyricsOverlay />
    ) : mode === "mini" ? (
      <MiniPlayerWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
