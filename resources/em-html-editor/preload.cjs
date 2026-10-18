// This editor never receives the workspace's general-purpose application bridge.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("editorAPI", {
  openInBrowser: () => ipcRenderer.invoke("editor:open-current"),
  onUiLanguageChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("settings:uiLanguageChanged", handler);
    return () => ipcRenderer.removeListener("settings:uiLanguageChanged", handler);
  },
});
