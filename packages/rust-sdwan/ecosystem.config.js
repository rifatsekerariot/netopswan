// NetOpsWan - netops-hub pm2 Süreç Denetimi Yapılandırması
//
// Tünel kararlılığı düzeltmesi: hub önceden ad-hoc `pm2 start <binary>` ile
// çalıştırılıyordu - repo'da hiçbir autorestart/max_restarts/backoff politikası
// tanımlı değildi (pm2'nin kendi varsayılanlarına bırakılmıştı, versiyon kontrolü
// altında değildi, sunucudan sunucuya farklılaşabilirdi). Bu dosya artık:
//   1) autorestart'ı açıkça garanti eder (çökme = otomatik yeniden başlatma),
//   2) art arda hızlı çökmelerde (crash-loop) restart'lar arasına üstel backoff
//      ekler - önceki "53 restart / <1 saat" olayında olduğu gibi CPU/log
//      taşırmadan,
//   3) `min_uptime` ile "gerçekten ayakta kaldı" (30sn+) ile "hemen çöktü"
//      ayrımını netleştirir,
//   4) RESDISC-004'ün kasıtlı fail-closed `exit(1)`'i (izolasyon kuralları
//      doğrulanamazsa) için `kill_timeout` ile temiz kapanışa zaman tanır.
//
// Kullanım: `pm2 start ecosystem.config.js` (bu dosyanın bulunduğu dizinden,
// yani `packages/rust-sdwan/`) - `target/release/netops-hub` önceden derlenmiş
// olmalı (`cargo build --release --bin netops-hub`).
module.exports = {
  apps: [
    {
      name: 'netops-hub',
      script: './target/release/netops-hub',
      cwd: __dirname,
      interpreter: 'none',
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 15,
      min_uptime: '30s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      merge_logs: true,
      time: true,
    },
  ],
};
