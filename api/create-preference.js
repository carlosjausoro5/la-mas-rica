// api/create-preference.js
// Crea una preferencia de pago (Checkout Pro) en Mercado Pago.
// El frontend le pega a esta URL en vez de a la de base44.

import { crearPedido } from './_supabase.js';

export default async function handler(req, res) {
  // CORS: permití que tu página llame a este endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Falta MP_ACCESS_TOKEN en el servidor' });
  }

  try {
    const { items, payer, deliveryCost, tipoEntrega, backUrl } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío' });
    }

    // Armamos los items en el formato que espera Mercado Pago
    const mpItems = items.map((it) => ({
      title: String(it.title).slice(0, 250),
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      currency_id: 'ARS',
    }));

    if (deliveryCost && Number(deliveryCost) > 0) {
      mpItems.push({
        title: tipoEntrega === 'envio' ? 'Envío a domicilio' : 'Retiro en el local',
        quantity: 1,
        unit_price: Number(deliveryCost),
        currency_id: 'ARS',
      });
    }

    const base = backUrl || '';

    const body = {
      items: mpItems,
      payer: {
        name: payer?.name || '',
        surname: payer?.surname || '',
        phone: payer?.phone ? { number: String(payer.phone) } : undefined,
      },
      back_urls: {
        success: `${base}?status=approved`,
        pending: `${base}?status=pending`,
        failure: `${base}?status=rejected`,
      },
      auto_return: 'approved',
      notification_url: process.env.MP_WEBHOOK_URL || undefined,
      metadata: {
        direccion: payer?.address || '',
        tipo_entrega: tipoEntrega || '',
      },
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('Error de Mercado Pago:', data);
      return res.status(mpRes.status).json({ error: data.message || 'Error al crear la preferencia' });
    }

    // Guardamos el pedido como "pendiente de pago" antes de mandar al cliente
    // a Mercado Pago. El webhook lo va a actualizar cuando el pago se confirme.
    const total = mpItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
    await crearPedido({
      preference_id: data.id,
      estado: 'pending_payment',
      nombre: payer?.name || '',
      apellido: payer?.surname || '',
      telefono: payer?.phone || '',
      direccion: payer?.address || '',
      notas: '',
      tipo_entrega: tipoEntrega || '',
      items,
      delivery_cost: Number(deliveryCost) || 0,
      total,
    });

    return res.status(200).json({ init_point: data.init_point });
  } catch (err) {
    console.error('Error interno:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
