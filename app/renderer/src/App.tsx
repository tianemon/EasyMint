import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SetupPage } from "./pages/SetupPage";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";

export function App(): JSX.Element {
  const isSetupComplete = localStorage.getItem("easymint_setup_complete") === "true";

  return (
    <div id="app-shell">
      <HashRouter>
        {!isSetupComplete ? (
          <Routes>
            <Route path="*" element={<OnboardingPage />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<ProjectPage />} />
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/setup/:projectId" element={<SetupPage />} />
            <Route path="/project/:projectId" element={<ProjectPage />} />
          </Routes>
        )}
      </HashRouter>
    </div>
  );
}
