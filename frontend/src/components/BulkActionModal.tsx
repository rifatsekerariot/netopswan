'use client';

import { useState } from 'react';
import { executeBulkAction } from '@/lib/api';
import { AlertTriangle, CheckCircle, RefreshCw, X, Zap } from 'lucide-react';

interface Props {
  selectedIds: string[];
  action: 'reboot' | 'toggle_sqm' | 'vpn_restart' | 'firmware_update' | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkActionModal({ selectedIds, action, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!action || selectedIds.length === 0) return null;

  const actionTitles: Record<string, string> = {
    reboot: 'Toplu Cihaz Yeniden Başlatma',
    toggle_sqm: 'Toplu SQM/QoS Durumu Değiştirme',
    vpn_restart: 'Toplu VPN Tüneli Yeniden Başlatma',
    firmware_update: 'Toplu Cihaz Yazılım Güncelleme'
  };

  const handleExecute = async () => {
    setLoading(true);
    try {
      const res = await executeBulkAction(selectedIds, action);
      setResult({ success: true, message: res.message });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1800);
    } catch {
      setResult({ success: false, message: 'Toplu işlem sırasında sunucu hatası oluştu.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border text-card-foreground rounded-xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/40">
          <div className="flex items-center gap-2 text-primary font-bold text-sm">
            <Zap className="w-4 h-4" /> {actionTitles[action]}
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div className={`p-4 rounded-xl border flex items-start gap-3 ${
              result.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-destructive/10 border-destructive/30 text-destructive'
            }`}>
              <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs font-medium">{result.message}</div>
            </div>
          ) : (
            <>
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold">Dikkat: İşlem Onayı</div>
                  <div>
                    Seçtiğiniz <span className="font-bold underline">{selectedIds.length} adet</span> Cisco Meraki MX64 cihazı üzerinde <span className="font-bold">{actionTitles[action]}</span> işlemi yürütülecektir.
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Bu işlem merkez sunucu toplu işlem kuyruğuna iletilecek ve cihazlar ile senkronize edilecektir.
              </p>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t bg-muted/40 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold rounded-lg transition-colors"
          >
            İptal
          </button>
          {!result && (
            <button
              onClick={handleExecute}
              disabled={loading}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'İşlemi Onayla ve Uygula'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
