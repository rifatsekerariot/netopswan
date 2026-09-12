/**
 * Device Sync Scheduler
 *
 * Automatically syncs database devices with Rust Hub every 5 minutes
 * Prevents device mismatch issues from persisting
 */

let syncInterval: NodeJS.Timeout | null = null;

// DAYANIKLILIK DÜZELTMESİ (2026-08-28, Faz 4): Rust hub/agent tarafında "sessizce
// ölen/askıda kalan arka plan görevi" sınıfı hatalar bulunup düzeltildikten sonra,
// aynı riskin bu modül-seviyeli setInterval için de geçerli olup olmadığı denetlendi.
// Burada süreci öldürüp yeniden başlatmak (Rust tarafındaki gibi) ORANTISIZ olur -
// tüm dashboard UI'ı gereksiz yere çöker sadece bir arka plan senkron görevi
// yüzünden. Bunun yerine, son BAŞARILI senkronun ne zaman olduğu izlenir ve çok
// uzun süre geçerse (30 dakika = 6 ardışık başarısız/atlanmış tur) operatörün log
// taramasında/izlemesinde kolayca yakalayabileceği net bir ERROR seviyeli satır
// yazılır - "her şey normal görünüyor ama veriler sessizce sapıyor" kör noktasını
// kapatmak için.
let lastSuccessfulSyncAt: number = Date.now();
const STALE_SYNC_THRESHOLD_MS = 30 * 60 * 1000; // 30 dakika (normal periyot: 5dk)

export function startDeviceSyncScheduler() {
  if (syncInterval) {
    console.log('Device sync scheduler already running');
    return;
  }

  console.log('Starting device sync scheduler (every 5 minutes)');

  // Run sync immediately on startup
  triggerDeviceSync();

  // Then run every 5 minutes
  syncInterval = setInterval(triggerDeviceSync, 5 * 60 * 1000);

  // Cleanup on process exit
  process.on('SIGTERM', () => {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      console.log('Device sync scheduler stopped');
    }
  });
}

export function stopDeviceSyncScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('Device sync scheduler stopped');
  }
}

async function triggerDeviceSync() {
  try {
    // NOT: NEXT_PUBLIC_API_URL tarayıcı için tanımlanır ve genelde '/api' son ekini
    // zaten içerir (bkz. .env.production) - onu burada kullanmak
    // 'https://.../api/api/admin/sync-devices' gibi kırık, 404 dönen bir URL üretiyordu.
    // Sunucu kendi kendine dahili olarak 127.0.0.1 üzerinden çağırmalı.
    const port = process.env.PORT || '3000';
    const baseUrl = `http://127.0.0.1:${port}`;
    const internalSecret = process.env.INTERNAL_SYNC_SECRET;

    if (!internalSecret) {
      console.warn('INTERNAL_SYNC_SECRET tanımlı değil - device sync scheduler auth middleware tarafından engellenecek');
    }

    const response = await fetch(`${baseUrl}/api/admin/sync-devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(internalSecret ? { 'x-internal-sync-token': internalSecret } : {})
      },
      body: JSON.stringify({
        action: 'sync',
        cleanupDuplicates: true
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Device sync failed: ${response.status} - ${error}`);
      checkSyncStaleness();
      return;
    }

    const result = await response.json();
    lastSuccessfulSyncAt = Date.now();
    if (result.data?.synced > 0 || result.data?.cleaned > 0) {
      console.log(
        `Device sync: ${result.data.synced} synced, ${result.data.cleaned} cleaned`
      );
    }

    // Log duplicates if found
    if (result.data?.duplicates?.length > 0) {
      console.warn(
        `Found ${result.data.duplicates.length} duplicate device entries`,
        result.data.duplicates
      );
    }

    // Log mismatches
    if (result.data?.mismatches?.length > 0) {
      const issues = result.data.mismatches.filter(
        (m: any) => m.issue !== 'ID mismatch - corrected'
      );
      if (issues.length > 0) {
        console.warn(
          `Device mismatches detected: ${issues.length}`,
          issues.map((i: any) => `${i.dbName || i.dbId}: ${i.issue}`)
        );
      }
    }

    // Log errors
    if (result.data?.errors?.length > 0) {
      console.error('Device sync errors:', result.data.errors);
    }
  } catch (error) {
    console.error('Device sync trigger failed:', error);
    checkSyncStaleness();
  }
}

// Son başarılı senkrondan bu yana geçen süre eşiği aşıyorsa, aramalı loglarda
// kolayca yakalanabilecek net bir ERROR satırı yazar. `triggerDeviceSync` normal
// try/catch ile her tekil hatayı zaten yutuyordu (bir sonraki turda kendi kendine
// düzelebileceği için tek başına sorun değil) - eksik olan, ARDIŞIK başarısızlıkların
// operatöre hiç görünmemesiydi.
function checkSyncStaleness() {
  const staleMs = Date.now() - lastSuccessfulSyncAt;
  if (staleMs > STALE_SYNC_THRESHOLD_MS) {
    console.error(
      `🚨 [DEVICE SYNC WATCHDOG]: Son başarılı senkron ${Math.round(staleMs / 60000)} dakika önce - cihaz veritabanı hub'ın gerçek durumundan sapıyor olabilir. INTERNAL_SYNC_SECRET/ağ bağlantısını kontrol edin.`
    );
  }
}

