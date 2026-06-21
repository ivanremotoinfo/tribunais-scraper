const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '15000', 10);

function criarCliente(baseURL = '', extraHeaders = {}) {
  return axios.create({
    baseURL,
    timeout: TIMEOUT,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      ...extraHeaders
    },
    maxRedirects: 5
  });
}

// DD/MM/AAAA → AAAA-MM-DD  (ISO 8601)
function formatarData(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Já está em ISO ou formato desconhecido — devolve como veio
  return String(str).trim();
}

function limparTexto(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

// Remove tudo que não é dígito (para montar URLs de portais)
function apenasDigitos(numero) {
  return String(numero).replace(/\D/g, '');
}

// Converte número CNJ "0000001-00.2023.8.05.0001" → objeto com partes
function parsearNumeroCNJ(numero) {
  const limpo = String(numero).replace(/[^0-9.]/g, '').replace(/\./g, '-');
  const raw = apenasDigitos(numero);
  const m = String(numero).match(/(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})/);
  if (m) {
    return {
      raw,
      seq: m[1],
      dig: m[2],
      ano: m[3],
      segmento: m[4],
      tribunal: m[5],
      origem: m[6],
      cnj: numero
    };
  }
  // Número sem formatação com 20 dígitos
  if (raw.length === 20) {
    return {
      raw,
      seq: raw.slice(0, 7),
      dig: raw.slice(7, 9),
      ano: raw.slice(9, 13),
      segmento: raw.slice(13, 14),
      tribunal: raw.slice(14, 16),
      origem: raw.slice(16, 20),
      cnj: `${raw.slice(0,7)}-${raw.slice(7,9)}.${raw.slice(9,13)}.${raw.slice(13,14)}.${raw.slice(14,16)}.${raw.slice(16,20)}`
    };
  }
  return { raw, cnj: numero };
}

module.exports = { criarCliente, formatarData, limparTexto, apenasDigitos, parsearNumeroCNJ, UA, TIMEOUT };
