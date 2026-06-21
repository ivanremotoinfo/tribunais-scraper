# Tribunais Scraper — SuporteADV

Serviço Node.js que consulta andamentos processuais diretamente nos portais dos tribunais brasileiros. Complementa o proxy DataJud quando este retorna dados insuficientes.

## Tribunais suportados

| Código | Tribunal | Sistema | Estratégia |
|--------|----------|---------|------------|
| `tjba` | TJ Bahia | eProc | Axios + Cheerio ✅ |
| `trt5` | TRT 5ª Região | PJe | Axios (JSF) / Puppeteer |
| `trf1` | TRF 1ª Região | Processual | Axios + Cheerio ✅ |
| `tjsp` | TJ São Paulo | eSAJ | Axios + Cheerio ✅ |
| `tjrj` | TJ Rio de Janeiro | Portal próprio | Axios / Puppeteer |
| `tjmg` | TJ Minas Gerais | eSAJ + PJe | Axios + Cheerio ✅ |
| `stj`  | STJ | Portal próprio | Axios + Cheerio ✅ |
| `tst`  | TST | Portal próprio | Axios + Cheerio ✅ |

## Endpoints

```
GET  /health      → status do serviço
POST /andamentos  → consulta processo
```

### POST /andamentos

**Body:**
```json
{ "numero": "0000001-00.2023.8.05.0001", "tribunal": "tjba" }
```

**Retorno (sucesso):**
```json
{
  "sucesso": true,
  "andamentos": [
    { "data": "2025-06-20", "descricao": "Juntada de documento" },
    { "data": "2025-06-15", "descricao": "Conclusão ao juiz" }
  ],
  "tribunal": "TJBA"
}
```

**Retorno (falha):**
```json
{
  "sucesso": false,
  "erro": "Processo não encontrado ou portal indisponível",
  "andamentos": []
}
```

## Instalação local

```bash
cd tribunais-scraper
npm install
cp .env.example .env
# Edite .env com suas configurações
npm run dev
```

Acesse: http://localhost:3001/health

## Deploy no Render.com

1. Crie um repositório no GitHub com esta pasta
2. No Render.com → New Web Service → selecione o repo
3. Configurações:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
4. Environment Variables:
   ```
   CORS_ORIGINS=https://SEU_USUARIO.github.io,https://suporte.adv.br
   USE_PUPPETEER=false
   CACHE_TTL=3600
   REQUEST_TIMEOUT=15000
   ```
5. Copie a URL gerada (ex: `https://tribunais-scraper-xxxx.onrender.com`)

> **Free tier:** mantenha `USE_PUPPETEER=false`. O Puppeteer precisa do Chromium (~170MB) e usa ~300MB de RAM — incompatível com o free tier de 512MB.

## Integração com sistema.html

No seu `sistema.html`, adicione logo abaixo de `DATAJUD_BASE`:

```javascript
const DATAJUD_BASE   = 'https://datajud-proxy-itrj.onrender.com';
const TRIBUNAIS_BASE = 'https://tribunais-scraper-SEU-ID.onrender.com';

// Consulta com fallback automático
async function consultarAndamentos(numero, tribunal) {
  // 1ª tentativa: DataJud
  try {
    const sigla = tribunal.toUpperCase();
    const url = `${DATAJUD_BASE}/api_publica_${sigla}/_search`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { match: { numeroProcesso: numero } },
        size: 1
      })
    });
    const json = await resp.json();
    const processo = json.hits?.hits?.[0]?._source;
    const movimentos = processo?.movimentos || [];
    if (movimentos.length > 0) {
      return movimentos.map(m => ({ data: m.dataHora?.slice(0,10), descricao: m.nome }));
    }
  } catch (e) {
    console.warn('[datajud] Falhou, tentando scraper direto:', e.message);
  }

  // 2ª tentativa: scraper direto no tribunal
  try {
    const resp = await fetch(`${TRIBUNAIS_BASE}/andamentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero, tribunal })
    });
    const json = await resp.json();
    if (json.sucesso && json.andamentos?.length > 0) {
      return json.andamentos;
    }
  } catch (e) {
    console.warn('[scraper] Falhou:', e.message);
  }

  return [];
}
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta do servidor |
| `CORS_ORIGINS` | — | Origens permitidas (vírgula) |
| `USE_PUPPETEER` | `false` | Habilita Puppeteer |
| `CACHE_TTL` | `3600` | Cache em segundos |
| `REQUEST_TIMEOUT` | `15000` | Timeout HTTP em ms |

## Ajuste de seletores

Se um tribunal mudar o HTML do portal, edite o arquivo `scrapers/NOME.js` e ajuste os seletores CSS na função `parsearHtml()`. Cada scraper tem múltiplos seletores com fallback automático.

## Logs

No Render.com, acesse Dashboard → seu serviço → Logs. Cada consulta gera uma linha:
```
[consulta] tribunal=tjba numero=0000001-00.2023.8.05.0001
[tjba] GET https://eproc.tjba.jus.br/...
[ok] tjba/... — 12 andamentos em 340ms
```
