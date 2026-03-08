const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listNotes:   (folder)                    => ipcRenderer.invoke('fs:list-notes', folder),
  listArchive: ()                          => ipcRenderer.invoke('fs:list-archive'),
  readFile:    (filename, folder, fromArchive) => ipcRenderer.invoke('fs:read-file', filename, folder, fromArchive),
  writeFile:   (filename, folder, content) => ipcRenderer.invoke('fs:write-file', filename, folder, content),
  createFile:  (title, folder)             => ipcRenderer.invoke('fs:create-file', title, folder),
  archiveFile: (filename, folder)          => ipcRenderer.invoke('fs:archive-file', filename, folder),
  restoreFile: (filename, targetFolder)    => ipcRenderer.invoke('fs:restore-file', filename, targetFolder),
  renameFile:  (oldFilename, newTitle, folder) => ipcRenderer.invoke('fs:rename-file', oldFilename, newTitle, folder),
});
