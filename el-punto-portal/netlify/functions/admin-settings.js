import { BUSINESS_WHATSAPP } from '../../src/businessConfig.js';
import { getSupabaseAdmin, json, parseBody, validateAdminPin } from './_supabaseAdmin.js';

function toRow(settings) {
  return {
    business_name: settings.name || settings.business_name || 'El Punto',
    subtitle: settings.subtitle || 'Food To Go',
    whatsapp_number: BUSINESS_WHATSAPP,
    google_maps_url: settings.googleMapsUrl || settings.google_maps_url || '',
    crypto_btc_wallet: settings.cryptoBtcWallet || settings.crypto_btc_wallet || '',
    crypto_eth_wallet: settings.cryptoEthWallet || settings.crypto_eth_wallet || '',
    crypto_usdt_trc20_wallet: settings.cryptoUsdtTrc20Wallet || settings.crypto_usdt_trc20_wallet || '',
    crypto_note: settings.cryptoNote || settings.crypto_note || '',
    updated_at: new Date().toISOString()
  };
}

export async function handler(event) {
  try {
    const body = parseBody(event);
    const pin = body.adminPin || event.headers['x-admin-pin'];
    if (!validateAdminPin(pin)) return json(401, { error: 'PIN de admin inválido.' });
    const supabase = getSupabaseAdmin();

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('business_settings').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return json(200, { settings: data });
    }
    if (event.httpMethod === 'POST' || event.httpMethod === 'PATCH') {
      const { data: existing, error: existingError } = await supabase.from('business_settings').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (existingError) throw new Error(existingError.message);
      const payload = { ...(existing?.id ? { id: existing.id } : {}), ...toRow(body.settings || body) };
      const { data, error } = await supabase.from('business_settings').upsert(payload).select('*').single();
      if (error) throw new Error(error.message);
      return json(200, { settings: data });
    }
    return json(405, { error: 'Método no permitido.' });
  } catch (error) {
    return json(500, { error: error.message || 'Error inesperado en configuración.' });
  }
}
