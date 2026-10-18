import { createRoot } from "react-dom/client";
import { DataProvider } from "./state.tsx";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <DataProvider>
    <App />
  </DataProvider>,
);
