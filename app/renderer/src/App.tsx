import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSettingsStore } from "./stores/settings-store";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );

  // Restore persisted settings (model list, API keys, etc.) on startup.
  // Also fall back to main-process setupComplete if localStorage was lost
  // (e.g. after Electron userData path change or cache clear).
  useEffect(() => {
    useSettingsStore.getState().loadFromElectron().then(() => {
      const fromMain = useSettingsStore.getState().setupComplete;
      if (fromMain && !setupComplete) {
        localStorage.setItem("easymint_setup_complete", "true");
        setSetupComplete(true);
      }
    });
  }, []);

  useEffect(() => {
    const handler = () => setSetupComplete(true);
    window.addEventListener("easymint-setup-complete", handler);
    return () => window.removeEventListener("easymint-setup-complete", handler);
  }, []);

  return (
    <ErrorBoundary>
      <div id="app-shell">
        <HashRouter>
          {!setupComplete ? (
            <Routes>
              <Route path="*" element={<OnboardingPage />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<ProjectPage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
            </Routes>
          )}
        </HashRouter>
      </div>
    </ErrorBoundary>
  );
}
