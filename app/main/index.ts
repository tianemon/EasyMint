import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc-handlers";
import { ProjectService } from "./services/project-service";
import { FileService } from "./services/file-service";
import { AgentService, setMainWindow } from "./services/agent-service";
import { EvaluatorService } from "./services/evaluator-service";
import { Store } from "./services/store";
import { detectClaude } from "./utils/claude-detector";

const isDev = !app.isPackaged;

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "dist", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setMainWindow(mainWindow);
  detectClaude(); // warm up detection for claude:detect IPC handler

  const store = new Store();
  const projectService = new ProjectService(store);
  const fileService = new FileService();
  const agentService = new AgentService();
  // Claude path no longer needed — SDK manages its own binary
  const evaluatorService = new EvaluatorService();

  registerIpcHandlers({ mainWindow, projectService, fileService, agentService, evaluatorService, store });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
