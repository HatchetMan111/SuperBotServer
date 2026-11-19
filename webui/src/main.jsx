import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Theme früh setzen (vor dem ersten Paint), persisted in localStorage.
const saved = localStorage.getItem("superbot-theme");
if (saved) document.documentElement.dataset.theme = saved;
else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";

createRoot(document.getElementById("root")).render(<App />);
