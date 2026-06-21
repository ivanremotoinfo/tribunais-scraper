// Resolve CAPTCHAs de imagem usando Claude Vision (se ANTHROPIC_API_KEY estiver definido)
// Fallback: Tesseract OCR com preprocessing via Jimp

const Tesseract = require('tesseract.js');

async function resolverComClaude(imagemBase64) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });
    const resposta = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagemBase64 } },
          { type: 'text', text: 'Leia os 6 caracteres alfanuméricos (letras minúsculas e dígitos) desta imagem CAPTCHA. Responda APENAS com os 6 caracteres, sem espaços ou explicações.' }
        ]
      }]
    });
    const texto = resposta.content[0]?.text?.trim() || '';
    const limpo = texto.replace(/[^a-z0-9]/gi, '').toLowerCase();
    console.log(`[captcha-solver] Claude Vision: "${texto}" → limpo: "${limpo}"`);
    return limpo.length >= 6 ? limpo.substring(0, 6) : null;
  } catch (err) {
    console.warn('[captcha-solver] Claude Vision falhou:', err.message);
    return null;
  }
}

async function preprocessarImagem(imagemBase64) {
  try {
    const { Jimp, JimpMime } = require('jimp');
    const buffer = Buffer.from(imagemBase64, 'base64');
    const img = await Jimp.fromBuffer(buffer);
    img.greyscale().scale(3).contrast(0.5).threshold({ max: 160 });
    return await img.getBuffer(JimpMime.png);
  } catch (err) {
    console.warn('[captcha-solver] Preprocessing falhou:', err.message);
    return Buffer.from(imagemBase64, 'base64');
  }
}

async function resolverComTesseract(imagemBase64) {
  try {
    const buffer = await preprocessarImagem(imagemBase64);
    const result = await Tesseract.recognize(buffer, 'eng', {
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz0123456789',
      tessedit_pageseg_mode: '7',
    });
    const raw = result.data.text.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const confianca = Math.round(result.data.confidence);
    console.log(`[captcha-solver] Tesseract: "${raw}" (confiança ${confianca}%)`);
    if (raw.length >= 6) return raw.substring(0, 6);
  } catch (err) {
    console.warn('[captcha-solver] Tesseract falhou:', err.message);
  }
  return null;
}

/**
 * Resolve CAPTCHA de imagem base64.
 * Usa Claude Vision (se ANTHROPIC_API_KEY definido) ou Tesseract como fallback.
 */
async function resolverCaptcha(imagemBase64) {
  if (!imagemBase64) return null;
  const claudeResult = await resolverComClaude(imagemBase64);
  if (claudeResult) return claudeResult;
  return resolverComTesseract(imagemBase64);
}

module.exports = { resolverCaptcha };
