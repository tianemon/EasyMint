import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectListPage } from "./pages/ProjectListPage";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );

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
              <Route path="/projects" element={<ProjectListPage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
            </Routes>
          )}
        </HashRouter>
      </div>
    </ErrorBoundary>
  );
}
