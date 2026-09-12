'use client';

import React, { useState } from 'react';
import {
  Terminal,
  Activity,
  Zap,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  Radio,
  FileText
} from 'lucide-react';
import { Device, executeDeviceDiagnostic } from '@/lib/api';

interface DeviceDiagnosticsModalProps {
  device: Device | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function DeviceDiagnosticsModal({
  device,
  isOpen,
  onClose
}: DeviceDiagnosticsModalProps) {
  const [activeTab, setActiveTab] = useState<'ping' | 'traceroute' | 'logs' | 'tcpport' | 'lan_clients'>('ping');
  const [targetHost, setTargetHost] = useState('8.8.8.8');
  const [targetPort, setTargetPort] = useState<number>(443);
  const [isRunning, setIsRunning] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string>('');

  if (!isOpen || !device) return null;

  const handleRunDiagnostic = async () => {
    setIsRunning(true);
    const targetLabel = device.last_ip ? `${device.name} (${device.last_ip})` : device.name;
    setConsoleOutput(`[SD-WAN Diagnostic Engine] -> ${targetLabel}\nKomut yürütülüyor, lütfen bekleyin...\n`);

    try {
      const diagType = activeTab === 'logs' ? 'syslog' : (activeTab === 'lan_clients' ? 'lan_clients' : activeTab);
      const res = await executeDeviceDiagnostic(
        device.id,
        diagType as any,
        targetHost,
        targetPort
      );
      setConsoleOutput(
        `[SD-WAN Diagnostic Engine] -> ${targetLabel}\n` +
        `--------------------------------------------------------------------------------\n` +
        res.output +
        `\n--------------------------------------------------------------------------------\n` +
        `[DURUM]: Tanı sorgusu başarıyla tamamlandı.`
      );
    } catch (err: any) {
      setConsoleOutput(
        `[SD-WAN Diagnostic Engine] -> HATA\n` +
        `Komut yürütülürken hata oluştu: ${err.message}`
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-card border rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 text-primary rounded-xl">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Canlı Uzaktan Teşhis & Tanı (Diagnostics)</h3>
              <p className="text-xs text-muted-foreground font-mono">
                {device.name} {device.last_ip ? `(${device.last_ip})` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-2 border-b pb-2 text-xs font-semibold">
          <button
            onClick={() => { setActiveTab('ping'); setConsoleOutput(''); }}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              activeTab === 'ping' ? 'bg-primary text-primary-foreground font-bold shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> Canlı Ping
          </button>
          <button
            onClick={() => { setActiveTab('traceroute'); setConsoleOutput(''); }}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              activeTab === 'traceroute' ? 'bg-primary text-primary-foreground font-bold shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Activity className="w-3.5 h-3.5" /> Traceroute
          </button>
          <button
            onClick={() => { setActiveTab('tcpport'); setConsoleOutput(''); }}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              activeTab === 'tcpport' ? 'bg-primary text-primary-foreground font-bold shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Radio className="w-3.5 h-3.5" /> L7 Port / Servis Testi
          </button>
          <button
            onClick={() => { setActiveTab('lan_clients'); setConsoleOutput(''); }}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              activeTab === 'lan_clients' ? 'bg-primary text-primary-foreground font-bold shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-emerald-500" /> LAN İstemcileri (DHCP/ARP)
          </button>
          <button
            onClick={() => { setActiveTab('logs'); setConsoleOutput(''); }}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              activeTab === 'logs' ? 'bg-primary text-primary-foreground font-bold shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Sistem Logları
          </button>
        </div>

        {/* Input Parameters */}
        {activeTab !== 'logs' && activeTab !== 'lan_clients' && (
          <div className="flex items-center gap-2.5">
            <div className="flex-1">
              <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                Hedef IP veya Hostname
              </label>
              <input
                type="text"
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
                placeholder="Örn: 10.0.1.50 veya erp.musteri.local"
                className="w-full text-xs px-3 py-2 bg-muted/30 border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>
            {activeTab === 'tcpport' && (
              <div className="w-28">
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                  TCP Port
                </label>
                <input
                  type="number"
                  value={targetPort}
                  onChange={(e) => setTargetPort(parseInt(e.target.value) || 80)}
                  placeholder="443, 1433"
                  className="w-full text-xs px-3 py-2 bg-muted/30 border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
            )}
            <div className="pt-5">
              <button
                onClick={handleRunDiagnostic}
                disabled={isRunning}
                className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRunning ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" /> Yürütülüyor...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" /> Testi Başlat
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex justify-end text-xs">
            <button
              onClick={handleRunDiagnostic}
              disabled={isRunning}
              className="px-4 py-1.5 bg-primary text-primary-foreground font-bold rounded-lg shadow hover:bg-primary/90 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {isRunning ? 'Loglar Çekiliyor...' : 'Logları Canlı Çek'}
            </button>
          </div>
        )}

        {/* Diagnostic Terminal Output Display */}
        <div className="bg-black/90 border border-border/40 rounded-xl p-4 min-h-[220px] max-h-[280px] overflow-y-auto font-mono text-[11px] text-emerald-400 space-y-1">
          {consoleOutput ? (
            <pre className="whitespace-pre-wrap leading-relaxed">{consoleOutput}</pre>
          ) : (
            <p className="text-muted-foreground opacity-60">
              Testi başlatmak için yukarıdaki butona tıklayın. Komut şube cihazına iletilecek ve sonuçlar burada gerçek zamanlı akacaktır.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg text-xs font-semibold hover:bg-muted"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
