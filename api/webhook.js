// api/webhook.js
// Mercado Pago llama a esta URL cuando el estado de un pago cambia.
// Acá es donde deberías guardar el pedido en una base de datos como "pagado de verdad",
// porque el status=approved en la URL de vuelta al sitio se puede falsear.

import { actualizarPedidoPorPreference } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  try {
    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      const payment = await mpRes.json();

      // payment.status puede ser: approved, pending, rejected, cancelled, etc.
      console.log('Pago recibido:', payment.id, payment.status, payment.transaction_amount);

      // Actualizamos el pedido guardado (buscándolo por preference_id) con el
      // estado real del pago y el payment_id de Mercado Pago.
      if (payment.order?.id || payment.preference_id) {
        const preferenceId = payment.preference_id || payment.order?.id;
        await actualizarPedidoPorPreference(preferenceId, {
          estado: payment.status,
          payment_id: String(payment.id),
        });
      }

      // TODO opcional: mandate una notificación al local (email, Telegram, etc.)
      // cuando payment.status === 'approved'.
    }

    // Siempre respondé 200 rápido, o Mercado Pago reintenta el webhook
    return res.status(200).end();
  } catch (err) {
    console.error('Error en webhook:', err);
    return res.status(200).end(); // igual devolvemos 200 para que MP no reintente en loop
  }
}
