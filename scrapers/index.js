const tjba = require('./tjba');
const tjsc = require('./tjsc');
const tjsp = require('./tjsp');
const tjrj = require('./tjrj');
const tjmg = require('./tjmg');
const tjpr = require('./tjpr');
const tjrs = require('./tjrs');
const trt5 = require('./trt5');
const trf1 = require('./trf1');
const trf2 = require('./trf2');
const trf3 = require('./trf3');
const trf4 = require('./trf4');
const trf5 = require('./trf5');
const stj  = require('./stj');
const tst  = require('./tst');
const trtGenerico = require('./trt-generico');
const tjGenerico  = require('./tj-generico');

const SCRAPERS = { tjba, tjsc, tjsp, tjrj, tjmg, tjpr, tjrs, trt5, trf1, trf2, trf3, trf4, trf5, stj, tst };

async function consultar({ numero, tribunal }) {
  // TRTs genéricos (trt1–trt24) via DataJud
  if (/^trt\d+$/.test(tribunal)) {
    try {
      return await trtGenerico.consultar(numero, tribunal);
    } catch (err) {
      console.error(`[scraper:${tribunal}] Exceção não tratada:`, err.message);
      return { sucesso: false, erro: `Erro no scraper ${tribunal}: ${err.message}`, andamentos: [] };
    }
  }

  // TJs genéricos (tjce, tjpe, tjgo, etc.) via DataJud — fallback para TJs sem scraper específico
  if (/^tj[a-z]{2}$/.test(tribunal) && !SCRAPERS[tribunal]) {
    try {
      return await tjGenerico.consultar(numero, tribunal);
    } catch (err) {
      console.error(`[scraper:${tribunal}] Exceção não tratada:`, err.message);
      return { sucesso: false, erro: `Erro no scraper ${tribunal}: ${err.message}`, andamentos: [] };
    }
  }

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
