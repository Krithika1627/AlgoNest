import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "../styles/globals.css";

const root = document.createElement("div");
root.id = "root";
document.body.appendChild(root);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
