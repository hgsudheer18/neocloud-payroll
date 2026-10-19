import { createRoot } from "react-dom/client";
import { ErpProvider } from "./erp.tsx";
import { DataProvider } from "./state.tsx";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <ErpProvider>
    <DataProvider>
      <App />
    </DataProvider>
  </ErpProvider>,
);
