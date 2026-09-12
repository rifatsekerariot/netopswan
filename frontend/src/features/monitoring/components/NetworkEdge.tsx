'use client';

import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import { Icons } from '@/components/icons';

export function NetworkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });

  const isUp = Boolean(data?.status === 'up');
  const rtt = typeof data?.rtt_ms === 'number' ? data.rtt_ms : 12.5;
  const protocol = typeof data?.protocol === 'string' ? data.protocol : 'WireGuard';

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: 2.5,
          stroke: isUp ? '#0ea5e9' : 'var(--destructive)',
          strokeDasharray: isUp ? '5,5' : 'none',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="px-2.5 py-1 rounded-full bg-card border border-border/80 text-[10px] flex items-center gap-1.5 transition-colors hover:border-primary/50"
        >
          <Icons.shieldCheck className={`w-3 h-3 ${isUp ? 'text-primary' : 'text-destructive'}`} />
          <span className="font-mono font-bold text-foreground">{String(protocol)}</span>
          <span className="text-muted-foreground">|</span>
          <span className="font-mono font-semibold text-primary tabular-nums">{String(rtt)} ms</span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
