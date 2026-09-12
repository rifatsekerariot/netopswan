'use client';

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Icons } from '@/components/icons';
import { TopologyNode } from '@/lib/api';

interface DeviceNodeProps {
  data: TopologyNode;
  selected?: boolean;
}

export const DeviceNode = memo(({ data, selected }: DeviceNodeProps) => {
  const isHub = data.type === 'hub';
  const isOnline = data.status === 'online';

  return (
    <div
      className={`min-w-[280px] rounded-xl border bg-card transition-colors duration-200 cursor-pointer ${
        selected ? 'ring-2 ring-primary border-primary' : 'border-border/80 hover:border-primary/50'
      } ${!isOnline ? 'opacity-70' : ''}`}
    >
      {/* Cihaz Başlık ve Yönetim Çubuğu */}
      <div
        className={`px-3.5 py-2.5 border-b rounded-t-xl flex items-center justify-between gap-2 ${
          isHub
            ? 'bg-primary/10 border-primary/20 text-primary'
            : isOnline
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-destructive/10 border-destructive/20 text-destructive'
        }`}
      >
        <div className="flex items-center gap-2">
          {isHub ? (
            <Icons.server className="w-4 h-4 text-primary" />
          ) : (
            <Icons.router className="w-4 h-4" />
          )}
          <div>
            <h4 className="text-xs font-bold font-mono tracking-tight text-foreground">{data.name || data.id}</h4>
            <p className="text-[10px] text-muted-foreground">{data.model || 'Edge Router'}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-destructive'}`}
          />
          <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
            {isOnline ? 'OPERASYONEL' : 'ÇEVRİMDIŞI'}
          </span>
        </div>
      </div>

      {/* Donanım ve Telemetri Özeti */}
      <div className="p-3 space-y-2.5 text-[11px]">
        <div className="grid grid-cols-2 gap-2 pb-2 border-b border-border/60">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground block font-semibold">Yönetim IP (WAN)</span>
            <span className="font-mono text-foreground font-medium">{data.management_ip || '-'}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground block font-semibold">Tünel IP (Overlay)</span>
            <span className="font-mono text-primary font-bold">{data.virtual_ip || data.ip || '-'}</span>
          </div>
        </div>

        {/* Canlı Donanım Metrikleri */}
        {!isHub && isOnline && (
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Icons.cpu className="w-3 h-3 text-sky-500 shrink-0" />
              <span>CPU: <strong className="text-foreground font-mono font-bold tabular-nums">{(data.cpu_usage_pct || 0).toFixed(1)}%</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Icons.hardDrive className="w-3 h-3 text-amber-500 shrink-0" />
              <span>RAM: <strong className="text-foreground font-mono font-bold tabular-nums">{data.ram_used_mb || 0} MB</strong></span>
            </div>
          </div>
        )}

        {/* Port & Arayüz Seviyesi Bağlantı Noktaları */}
        <div className="pt-1 space-y-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold block">Arayüz Portları (Interfaces)</span>
          <div className="space-y-1">
            {(data.interfaces || []).map((iface) => {
              const isUp = iface.status === 'up';
              const isOverlay = iface.type === 'wireguard';
              const isBridge = iface.type === 'bridge';

              return (
                <div
                  key={iface.id}
                  className={`relative px-2.5 py-1.5 rounded-lg border text-[10px] flex items-center justify-between gap-2 ${
                    isOverlay
                      ? 'bg-primary/5 border-primary/20 text-primary'
                      : isBridge
                      ? 'bg-amber-500/5 border-amber-500/20 text-foreground'
                      : 'bg-muted/40 border-border text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    <span className="font-mono font-bold">{iface.name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">{iface.ip_address || '-'}</span>

                  {/* React Flow Connection Handles (Port Uçları) */}
                  {isHub ? (
                    <Handle
                      type="source"
                      position={Position.Bottom}
                      id={iface.id}
                      className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background !bottom-[-6px]"
                    />
                  ) : isOverlay ? (
                    <Handle
                      type="target"
                      position={Position.Top}
                      id={iface.id}
                      className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background !top-[-6px]"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

DeviceNode.displayName = 'DeviceNode';
