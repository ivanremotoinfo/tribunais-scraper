// Puppeteer é opcional — só carregado quando USE_PUPPETEER=true
let puppeteerCore = null;
let browser = null;

function isEnabled() {
  return process.env.USE_PUPPETEER === 'true';
}

async function getExecutablePath() {
  // Tenta usar o chromium instalado via npm (pacote 'chromium')
  try {
    const chromium = require('chromium');
    const path = chromium.path;
    console.log('[puppeteer] Chromium via npm encontrado em:', path);
    return path;
  } catch (_) {}

  // Fallback: caminhos do sistema
  const fs = require('fs');
  const caminhos = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ];
  for (const c of caminhos) {
    if (fs.existsSync(c)) {
      console.log('[puppeteer] Chromium do sistema encontrado em:', c);
      return c;
    }
  }

  throw new Error('Chromium não encontrado. Instale o pacote npm "chromium" ou defina PUPPETEER_EXECUTABLE_PATH.');
}

async function getBrowser() {
  if (!isEnabled()) throw new Error('Puppeteer desabilitado. Defina USE_PUPPETEER=true para ativar.');
  if (!puppeteerCore) {
    puppeteerCore = require('puppeteer-core');
  }
  if (!browser || !browser.isConnected()) {
    console.log('[puppeteer] Iniciando browser...');
    const executablePath = await getExecutablePath();
    browser = await puppeteerCore.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    browser.on('disconnected', () => { browser = null; });
  }
  return browser;
}

async function fetchComPuppeteer(url, { seletor, timeout = 12000 } = {}) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout });
    if (seletor) {
      await page.waitForSelector(seletor, { timeout: 5000 }).catch(() => {});
    }
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { isEnabled, getBrowser, fetchComPuppeteer };
