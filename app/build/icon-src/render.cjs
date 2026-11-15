// Render icon.svg to PNG via Chromium canvas. Usage: electron render.cjs <svg> <out.png> <size>
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [svgPath, outPath, sizeStr] = process.argv.slice(-3)
const size = Number(sizeStr)
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false })
  await w.loadURL('data:text/html,<html></html>')
  const svg = fs.readFileSync(svgPath, 'utf8')
  const dataUrl = await w.webContents.executeJavaScript(`new Promise((res) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size}); res(c.toDataURL('image/png')); };
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
  })`)
  fs.writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'))
  app.quit()
})
