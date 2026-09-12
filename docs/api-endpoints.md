# OpenWISP Controller & Monitoring REST API Referansı

Bu doküman, Next.js frontend panelinin OpenWISP Backend ile haberleşirken kullandığı temel REST API endpoint sözleşmelerini tanımlar.

---

## Yetkilendirme (Authentication)

Tüm isteklerde `Authorization` HTTP header'ı kullanılır:
`Authorization: Bearer <API_TOKEN>` veya `Token <API_TOKEN>`

---

## Endpoint Listesi

### 1. Cihazlar (Devices)
- **Cihaz Listesi (Paginated & Filtered)**:
  - `GET /api/v1/controller/device/`
  - Query Parametreleri:
    - `page` (int)
    - `page_size` (int, varsayılan 50 veya 100)
    - `group` (string, Device Group ID/Name)
    - `status` (string, `online` | `offline` | `problem`)
    - `search` (string, isim, MAC, IP arama)
  - Cevap Formatı:
    ```json
    {
      "count": 500,
      "next": "/api/v1/controller/device/?page=2",
      "previous": null,
      "results": [
        {
          "id": "uuid-1",
          "name": "Sube-001-MX64",
          "mac_address": "00:11:22:33:44:55",
          "ip_address": "192.168.10.1",
          "model": "Cisco Meraki MX64",
          "firmware": "OpenWrt 23.05.2",
          "status": "online",
          "group": "Bolge-Merkez",
          "last_seen": "2026-08-13T18:30:00Z"
        }
      ]
    }
    ```

- **Tek Cihaz Detayı**:
  - `GET /api/v1/controller/device/{id}/`

- **Cihaz Durum / Monitoring Bilgisi**:
  - `GET /api/v1/monitoring/device/{id}/`
  - Dönüş: CPU/RAM kullanımı, Uptime, Arayüz istatistikleri, Latency.

### 2. Cihaz Grupları (Device Groups)
- **Grup Listesi**:
  - `GET /api/v1/controller/group/`
  - Dönüş: `[ { "id": "grp-1", "name": "Bölge-Merkez", "device_count": 120 } ]`

### 3. Toplu İşlemler & Aksiyonlar (Bulk Actions & Tasks)
- **Toplu Firmware Güncelleme**:
  - `POST /api/v1/firmware/bulk-upgrade/`
  - Payload: `{ "device_ids": ["id1", "id2"], "image_id": "fw-v2.1" }`

- **Toplu Konfigürasyon / Komut Uygulama**:
  - `POST /api/v1/controller/device/bulk-action/`
  - Payload: `{ "device_ids": ["id1", "id2"], "action": "reboot" | "toggle_sqm" }`

### 4. Sistem Özeti (Dashboard Metrics)
- **Özet Durum Metrikleri**:
  - `GET /api/v1/monitoring/stats/`
  - Dönüş: `{ "total": 500, "online": 482, "offline": 15, "warning": 3 }`
