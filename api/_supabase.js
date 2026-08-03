// api/_supabase.js
// Cliente mínimo de Supabase usando fetch directo (sin dependencias extra,
// para que el proyecto siga sin necesitar "npm install" en Vercel).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };
}

// Inserta un pedido nuevo. Devuelve el registro creado (con su id).
export async function crearPedido(pedido) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Supabase no configurado: se omite guardado en base de datos');
    return null;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(pedido),
  });
  if (!res.ok) {
    console.error('Error creando pedido en Supabase:', await res.text());
    return null;
  }
  const data = await res.json();
  return data[0] || null;
}

// Actualiza un pedido buscándolo por preference_id (usado desde el webhook).
export async function actualizarPedidoPorPreference(preferenceId, cambios) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Supabase no configurado: se omite actualización en base de datos');
    return null;
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pedidos?preference_id=eq.${encodeURIComponent(preferenceId)}`,
    {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(cambios),
    }
  );
  if (!res.ok) {
    console.error('Error actualizando pedido en Supabase:', await res.text());
    return null;
  }
  return res.json();
}
