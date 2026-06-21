const tjba = require('./tjba');
const trt5 = require('./trt5');
const trf1 = require('./trf1');
const tjsp = require('./tjsp');
const tjrj = require('./tjrj');
const tjmg = require('./tjmg');
const stj  = require('./stj');
const tst  = require('./tst');

const SCRAPERS = { tjba, trt5, trf1, tjsp, tjrj, tjmg, stj, tst };

async function consultar({ numero, tribunal }) {
  const scraper = SCRAPERS[tribunal];
  if (!scraper) {
    return { sucesso: false, erro: `Tribunal "${tribunal}" não tem scraper disponível.`, andamentos: [] };
  }
  try {
    return await scraper.consultar(numero);
  } catch (err) {
    console.error(`[scraper:${tribunal}] Exceção não tratada:`, err.message);
    return { sucesso: false, erro: `Erro no scraper ${tribunal}: ${err.message}`, andamentos: [] };
  }
}

module.exports = { consultar };
