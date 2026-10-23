const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const projectRoot = path.join(__dirname, "..");
const sourcePath = path.join(projectRoot, "resources", "icon.svg");
const outputPath = path.join(projectRoot, "resources", "icon.png");

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const svg = fs.readFileSync(sourcePath).toString("base64");
  const html = `
    <!doctype html>
    <html>
      <head>
        <style>
          html, body {
            width: 1024px;
            height: 1024px;
            margin: 0;
            overflow: hidden;
            background: transparent;
          }
          img {
            display: block;
            width: 1024px;
            height: 1024px;
          }
        </style>
      </head>
      <body>
        <img src="data:image/svg+xml;base64,${svg}" />
      </body>
    </html>
  `;
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
    },
  });

  await window.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
  });
  fs.writeFileSync(outputPath, image.toPNG());
  window.destroy();
  app.quit();
});
