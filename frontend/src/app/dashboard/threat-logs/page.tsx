import ThreatLogsPage from '@/features/monitoring/components/threat-logs-page';

export const metadata = {
  title: 'Smart Log Lakehouse & Tehdit Analitiği | NetOps SD-WAN',
  description: 'DuckDB & Parquet destekli merkezi ağ loglama ve yapay zeka anomali dedektörü'
};

export default function Page() {
  return <ThreatLogsPage />;
}
