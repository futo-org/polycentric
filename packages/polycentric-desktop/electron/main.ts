import * as Electron from 'electron';
import * as ElectronIsDev from 'electron-is-dev';
import * as Path from 'path';

const createMainWindow = () => {
  let mainWindow = new Electron.BrowserWindow({
    width: Electron.screen.getPrimaryDisplay().workArea.width,
    height: Electron.screen.getPrimaryDisplay().workArea.height,
    show: false,
    backgroundColor: 'white',
    webPreferences: {
      nodeIntegration: true,
      devTools: true,
      contextIsolation: false,
    },
  });

  const startURL = ElectronIsDev
    ? 'http://localhost:3000'
    : `file://${Path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startURL);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    // mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    mainWindow.loadURL(details.url);
    return { action: 'deny' }; // Deny opening a new window
  });
};

Electron.app.whenReady().then(() => {
  createMainWindow();

  Electron.app.on('activate', () => {
    if (!Electron.BrowserWindow.getAllWindows().length) {
      createMainWindow();
    }
  });
});

Electron.app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    Electron.app.quit();
  }
});
