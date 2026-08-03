// api/pedidos.js
// Endpoint que sirve al panel de pedidos: lista pedidos y permite marcar
// "entregado". Protegido con una contraseña simple (header x-panel-password).

import { listarPedidos, actualizarEntregaPorId } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-panel-password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const password = req.headers['x-panel-password'];
  if (password !== process.env.PANEL_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (req.method === 'GET') {
    const pedidos = await listarPedidos();
    return res.status(200).json({ pedidos });
  }

  if (req.method === 'PATCH') {
    const { id, entregado } = req.body;
    if (id === undefined || entregado === undefined) {
      return res.status(400).json({ error: 'Falta id o entregado' });
    }
    await actualizarEntregaPorId(id, entregado);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
