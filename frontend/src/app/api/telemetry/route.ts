import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

// NOT: Allowlist - `range` asla ham SQL metnine enjekte edilmez, sadece bu
// haritadan sabit bir sayısal saat değeri seçilir (savunma amaçlı hardening;
// önceki string-interpolation zaten sadece 3 sabit literal üretebiliyordu ama
// gelecekte bir değişiklik bunu istemeden exploit edilebilir hale getirebilirdi).
const RANGE_HOURS: Record<string, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 24 * 7
};

export async function GET(request: Request) {
  try {
    const pool = getDbPool();
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '1h';
    const hours = RANGE_HOURS[range] ?? RANGE_HOURS['1h'];

    // NOT: tx_bytes/rx_bytes /proc/net/dev'den okunan KÜMÜLATİF sayaçlardır (arayüz
    // açıldığından beri toplam), anlık bir hız değil. Önceki sorgu bunları doğrudan
    // topluyordu - "Mbps" etiketiyle sürekli artan, gerçek bir orana karşılık gelmeyen
    // bir eğri üretiyordu. `deltas` CTE'si her cihaz için ardışık örnekler arası
    // byte/süre farkını (LAG penceresi ile) hesaplayıp gerçek bir Mbps oranına çevirir.
    // Sayaç sıfırlanması (agent restart) negatif delta üretebilir - GREATEST(...,0) ile
    // sıfırlanır.
    const query = `
      WITH deltas AS (
        SELECT
          device_id,
          recorded_at,
          rtt_ms,
          packet_loss_pct,
          GREATEST(rx_bytes - LAG(rx_bytes) OVER (PARTITION BY device_id ORDER BY recorded_at), 0) AS rx_delta,
          GREATEST(tx_bytes - LAG(tx_bytes) OVER (PARTITION BY device_id ORDER BY recorded_at), 0) AS tx_delta,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER (PARTITION BY device_id ORDER BY recorded_at))) AS secs_delta
        FROM netops_telemetry
        WHERE recorded_at >= NOW() - ($1 || ' hours')::interval
      )
      SELECT
        to_char(recorded_at, 'HH24:MI') AS time,
        ROUND((SUM(rx_delta) / NULLIF(SUM(secs_delta), 0) * 8 / 1024 / 1024)::numeric, 2) AS total_wan_rx,
        ROUND((SUM(tx_delta) / NULLIF(SUM(secs_delta), 0) * 8 / 1024 / 1024)::numeric, 2) AS total_wan_tx,
        ROUND(AVG(rtt_ms)::numeric, 1) AS avg_rtt,
        ROUND(AVG(packet_loss_pct)::numeric, 1) AS avg_loss
      FROM deltas
      WHERE secs_delta IS NOT NULL AND secs_delta > 0
      GROUP BY to_char(recorded_at, 'HH24:MI')
      ORDER BY MIN(recorded_at) ASC
      LIMIT 60;
    `;

    const res = await pool.query(query, [hours]);

    return NextResponse.json({
      success: true,
      range,
      count: res.rows.length,
      results: res.rows
    });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json(response, { status });
  }
}
