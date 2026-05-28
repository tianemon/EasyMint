import { HashRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { SetupPage } from "./pages/SetupPage";
import { ProjectPage } from "./pages/ProjectPage";

export function App(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ProjectPage />} />
        <Route path="/projects" element={<HomePage />} />
        <Route path="/setup/:projectId" element={<SetupPage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
      </Routes>
    </HashRouter>
  );
}
