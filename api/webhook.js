// api/webhook.js
// Mercado Pago llama a esta URL cuando el estado de un pago cambia.
// Acá es donde guardamos el pedido en la base de datos como "pagado de verdad",
// porque el status=approved en la URL de vuelta al sitio se puede falsear.

import crypto from 'crypto';
import { actualizarPedidoPorPreference } from './_supabase.js';

// Este secreto NO es el Access Token. Se genera aparte en:
// Tus integraciones > [tu app] > Webhooks > Configurar notificaciones
// y hay que guardarlo como variable de entorno MP_WEBHOOK_SECRET.
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

// Valida que la notificación realmente vino de Mercado Pago, comparando
// la firma que mandan en el header x-signature contra una firma calculada
// nosotros mismos con el secreto. Si alguien intenta pegarle a esta URL
// simulando ser Mercado Pago, esta validación corta el request acá.
function firmaValida(req, dataId) {
  if (!WEBHOOK_SECRET) {
    // Si todavía no configuraste el secreto, no podemos validar.
    // Preferimos avisar fuerte en los logs a fallar en silencio.
    console.error('MP_WEBHOOK_SECRET no está configurado: no se puede validar la firma.');
    return false;
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

  let ts, hash;
  xSignature.split(',').forEach(part => {
    const [key, value] = part.split('=');
    if (key?.trim() === 'ts') ts = value?.trim();
    if (key?.trim() === 'v1') hash = value?.trim();
  });
  if (!ts || !hash) return false;

  // El id se toma del query string (data.id), en minúsculas, tal como
  // lo pide la documentación de Mercado Pago.
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const firmaCalculada = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(firmaCalculada), Buffer.from(hash));
  } catch {
    // Los buffers tienen longitud distinta -> no coinciden
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  // El id del recurso puede venir en el body o en el query string según el
  // tipo de notificación; para la validación de firma MP pide tomarlo del
  // query string en minúsculas.
  const dataIdQuery = String(req.query?.['data.id'] || req.query?.id || '').toLowerCase();

  const { type, data } = req.body || {};

  // Payload que no nos interesa (no es de tipo "payment"): esto no es un
  // error nuestro, así que respondemos 200 y no reintenta.
  if (type !== 'payment' || !data?.id) {
    return res.status(200).end();
  }

  // Firma inválida: alguien está mandando un request que no viene de
  // Mercado Pago (o falta configurar el secreto). No procesamos, pero
  // tampoco hace falta que MP reintente esto, así que devolvemos 200
  // igual (evita que un atacante fuerce reintentos infinitos) y logueamos
  // fuerte para enterarnos.
  if (!firmaValida(req, dataIdQuery)) {
    console.error('Firma de webhook inválida o ausente. Notificación descartada.', {
      dataIdQuery, hasSecret: !!WEBHOOK_SECRET,
    });
    return res.status(200).end();
  }

  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    if (!mpRes.ok) {
      // La API de Mercado Pago falló (401, 404, 500, etc). Esto SÍ es un
      // problema de nuestro lado (o transitorio de MP) y conviene que
      // Mercado Pago reintente el webhook más tarde en vez de darlo por
      // procesado con datos vacíos.
      const cuerpoError = await mpRes.text().catch(() => '');
      console.error('Error al consultar el pago en Mercado Pago:', mpRes.status, cuerpoError);
      return res.status(500).end();
    }

    const payment = await mpRes.json();
    console.log('Pago recibido:', payment.id, payment.status, payment.transaction_amount);

    const preferenceId = payment.preference_id || payment.order?.id;

    if (!preferenceId) {
      // No tenemos forma de asociar este pago a un pedido guardado.
      // No es un error transitorio (reintentar no lo va a arreglar),
      // así que respondemos 200 pero dejamos rastro en los logs.
      console.error('Pago sin preference_id, no se pudo asociar a un pedido:', payment.id);
      return res.status(200).end();
    }

    // Si esto falla (Supabase caído, etc.), sí queremos que MP reintente,
    // por eso el error se propaga al catch de abajo en vez de tragárselo.
    await actualizarPedidoPorPreference(preferenceId, {
      estado: payment.status,
      payment_id: String(payment.id),
    });

    // TODO opcional: mandar una notificación al local (email, Telegram, etc.)
    // cuando payment.status === 'approved', para que la cocina se entere
    // sin depender de que el cliente mande el WhatsApp.

    return res.status(200).end();

  } catch (err) {
    // Error real de nuestro lado (Supabase caído, fetch falló, etc.):
    // devolvemos 500 para que Mercado Pago reintente la notificación
    // más tarde en vez de darla por perdida.
    console.error('Error en webhook:', err);
    return res.status(500).end();
  }
}
