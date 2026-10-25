const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    useContentSize: true,
    show: true,
  });
  win.loadFile(require('path').join(__dirname, 'test.html'));
});
