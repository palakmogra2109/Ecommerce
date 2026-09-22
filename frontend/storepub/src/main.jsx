import React from "react";
import { createRoot } from "react-dom/client";
import Storefront from "../../src/pages/Storefront.jsx";

const rootEl = document.getElementById("root");

createRoot(rootEl).render(
  <React.StrictMode>
    <Storefront />
  </React.StrictMode>
);
