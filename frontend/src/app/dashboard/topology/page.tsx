'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import Link from 'next/link';

import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import {
  fetchTopology,
  fetchBridges,
  createBridge,
  deleteBridge,
  fetchDevices,
  TopologyNode,
  InterBranchBridge,
  Device
} from '@/lib/api';
import { DeviceNode } from '@/features/monitoring/components/DeviceNode';
import { NetworkEdge } from '@/features/monitoring/components/NetworkEdge';
import DeviceDetailModal from '@/components/DeviceDetailModal';
import { ConfirmModal } from '@/components/ConfirmModal';

const nodeTypes = {
  device: DeviceNode,
  hub: DeviceNode
};

const edgeTypes = {
  tunnel: NetworkEdge
};

// Yoğun KPI satırı — overview/firewall/dhcp sayfalarındaki KpiRow ile aynı desen.
function KpiRow({
  label,
  value,
  caption,
  accent,
  icon: Icon
}: {
  label: string;
  value: React.ReactNode;
  caption: string;
  accent: 'primary' | 'emerald' | 'destructive' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
}) {
  const accentMap = {
    primary: { text: 'text-primary', dot: 'bg-primary' },
    emerald: { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    destructive: { text: 'text-destructive', dot: 'bg-destructive' },
    amber: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
  }[accent];

  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className={`w-1.5 h-1.5 rounded-full ${accentMap.dot} shrink-0`} />
      <Icon className={`w-3.5 h-3.5 ${accentMap.text} opacity-80 shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground leading-tight truncate">{label}</p>
      </div>
      <div className="text-right shrink-0">
        <span className="text-lg font-semibold font-mono tabular-nums leading-none">{value}</span>
        <p className="text-[10px] text-muted-foreground leading-tight">{caption}</p>
      </div>
    </div>
  );
}

// Dagre hiyerarşik otomatik yerleşim algoritması
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 120, nodesep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 320, height: 260 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: {
        x: nodeWithPosition.x - 160,
        y: nodeWithPosition.y - 130
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

export default function TopologyPage() {
  const queryClient = useQueryClient();
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [activeTab, setActiveTab] = useState<'topology' | 'bridges'>('topology');

  // New Bridge Modal State
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [sourceDevId, setSourceDevId] = useState('');
  const [targetDevId, setTargetDevId] = useState('');
  const [bridgeCustomName, setBridgeCustomName] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bridgeToDelete, setBridgeToDelete] = useState<InterBranchBridge | null>(null);

  // Queries
  const { data: topologyData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['sdwan-topology'],
    queryFn: fetchTopology,
    refetchInterval: 15000
  });

  const { data: bridgesData, isLoading: bridgesLoading } = useQuery({
    queryKey: ['sdwan-bridges'],
    queryFn: fetchBridges,
    refetchInterval: 10000
  });

  const { data: devicesData } = useQuery({
    queryKey: ['all-devices-for-bridge'],
    queryFn: () => fetchDevices({ page: 1, page_size: 100 })
  });

  const rawNodes = topologyData?.nodes || [];
  const rawLinks = topologyData?.links || [];
  const bridges: InterBranchBridge[] = bridgesData?.results || [];
  const allDevices: Device[] = devicesData?.results || [];

  // React Flow elemanlarına dönüştürme & otomatik yerleşim
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const rfNodes: Node[] = rawNodes.map((n) => ({
      id: n.id,
      type: 'device',
      data: n as any,
      position: { x: 0, y: 0 }
    }));

    const rfEdges: Edge[] = rawLinks.map((l) => ({
      id: l.id,
      source: l.source,
      sourceHandle: l.sourceHandle,
      target: l.target,
      targetHandle: l.targetHandle,
      type: 'tunnel',
      data: l as any,
      animated: l.status === 'up'
    }));

    // Inter-branch köprüleri de edge olarak ekle
    bridges.forEach((b) => {
      rfEdges.push({
        id: `bridge-${b.id}`,
        source: b.source_device_id,
        sourceHandle: `${b.source_device_id}-lan`,
        target: b.target_device_id,
        targetHandle: `${b.target_device_id}-lan`,
        type: 'tunnel',
        data: {
          status: 'up',
          protocol: 'Mesh Bridge',
          rtt_ms: 18.0
        },
        style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4,4' }
      });
    });

    return getLayoutedElements(rfNodes, rfEdges, 'TB');
  }, [rawNodes, rawLinks, bridges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Veri değiştiğinde (ID veya uzunluk) bir defa state'e aktar
  const rawNodesKey = useMemo(() => rawNodes.map(n => n.id).join(','), [rawNodes]);
  const rawLinksKey = useMemo(() => rawLinks.map(l => l.id).join(','), [rawLinks]);
  const bridgesKey = useMemo(() => bridges.map(b => b.id).join(','), [bridges]);

  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [rawNodesKey, rawLinksKey, bridgesKey]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data as unknown as TopologyNode);
  }, []);

  // Mutations
  const createBridgeMutation = useMutation({
    mutationFn: createBridge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sdwan-bridges'] });
      setIsBridgeModalOpen(false);
      setSourceDevId('');
      setTargetDevId('');
      setBridgeCustomName('');
      setFeedbackMessage({
        type: 'success',
        text: 'Şubeler arası güvenli doğrudan köprü ve dinamik yönlendirme rotaları başarıyla tesis edildi.'
      });
    },
    onError: () => {
      setFeedbackMessage({
        type: 'error',
        text: 'Köprü oluşturulamadı. Sunucuyla iletişim kurulamadı, lütfen tekrar deneyiniz.'
      });
    }
  });

  const deleteBridgeMutation = useMutation({
    mutationFn: deleteBridge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sdwan-bridges'] });
      setBridgeToDelete(null);
      setFeedbackMessage({
        type: 'success',
        text: 'Şubeler arası köprü rotaları ağ geçitlerinden başarıyla kaldırıldı.'
      });
    },
    onError: () => {
      setBridgeToDelete(null);
      setFeedbackMessage({
        type: 'error',
        text: 'Köprü kaldırılamadı. Sunucuyla iletişim kurulamadı, lütfen tekrar deneyiniz.'
      });
    }
  });

  const handleCreateBridgeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceDevId || !targetDevId || sourceDevId === targetDevId) {
      setFeedbackMessage({ type: 'error', text: 'Lütfen iki farklı uç nokta seçiniz.' });
      return;
    }
    const alreadyExists = bridges.some(
      (b) =>
        (b.source_device_id === sourceDevId && b.target_device_id === targetDevId) ||
        (b.source_device_id === targetDevId && b.target_device_id === sourceDevId)
    );
    if (alreadyExists) {
      setFeedbackMessage({ type: 'error', text: 'Bu iki şube arasında zaten aktif bir köprü mevcut.' });
      return;
    }
    createBridgeMutation.mutate({
      source_device_id: sourceDevId,
      target_device_id: targetDevId,
      name: bridgeCustomName || undefined
    });
  };

  const onlineCount = rawNodes.filter((n) => n.status === 'online').length;
  const offlineCount = rawNodes.length - onlineCount;
  const upLinks = rawLinks.filter((l) => l.status === 'up' && typeof l.rtt_ms === 'number');
  const avgRtt = upLinks.length
    ? upLinks.reduce((sum, l) => sum + (l.rtt_ms || 0), 0) / upLinks.length
    : null;

  const headerAction = (
    <button
      onClick={() => refetch()}
      disabled={isFetching}
      className="px-3 py-2 bg-background border hover:bg-muted text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
    >
      <Icons.refresh className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
      Telemetriyi yenile
    </button>
  );

  return (
    <PageContainer
      pageTitle="Ağ topolojisi ve arayüz orkestrasyonu"
      pageDescription="Merkez hub ve uç ağ geçitleri arasındaki arayüz bazlı bağlantı durumu, tünel telemetrisi ve köprü yönetimi"
      pageHeaderAction={headerAction}
    >
      <div className="flex flex-1 flex-col gap-5">
        {/* Yoğun durum satırları — canvas'a dalmadan önce anlık ağ özeti */}
        <div className="bg-card border rounded-2xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 divide-border/60">
            <div className="sm:pr-4">
              <KpiRow label="Çevrimiçi şube" value={onlineCount} caption="bağlı ağ geçidi" accent="emerald" icon={Icons.checks} />
            </div>
            <div className="sm:px-4">
              <KpiRow label="Çevrimdışı şube" value={offlineCount} caption="bağlantı kesilmiş" accent="destructive" icon={Icons.alertCircle} />
            </div>
            <div className="sm:px-4">
              <KpiRow label="Aktif köprü" value={bridges.length} caption="şubeler arası mesh" accent="amber" icon={Icons.swap} />
            </div>
            <div className="sm:pl-4">
              <KpiRow label="Ortalama tünel gecikmesi" value={avgRtt !== null ? `${avgRtt.toFixed(1)}` : '—'} caption="ms (aktif tüneller)" accent="primary" icon={Icons.activity} />
            </div>
          </div>
        </div>

        {/* Sekme başlığı */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b">
          <div className="flex items-center gap-2 bg-muted/60 p-1 rounded-xl border max-w-full overflow-x-auto">
            <button
              onClick={() => setActiveTab('topology')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                activeTab === 'topology'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icons.network className="w-4 h-4 text-primary" />
              Operasyonel ağ haritası
            </button>
            <button
              onClick={() => setActiveTab('bridges')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                activeTab === 'bridges'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icons.swap className="w-4 h-4 text-amber-500" />
              Şubeler arası doğrudan köprüler ({bridges.length})
            </button>
          </div>

          {activeTab === 'bridges' && (
            <button
              onClick={() => setIsBridgeModalOpen(true)}
              className="px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Icons.add className="w-4 h-4" />
              Yeni köprü tesis et
            </button>
          )}
        </div>

        {/* Geri bildirim mesajı */}
        {feedbackMessage && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 border-destructive/20 text-destructive'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackMessage.type === 'success' ? (
                <Icons.check className="w-4 h-4" />
              ) : (
                <Icons.warning className="w-4 h-4" />
              )}
              <span>{feedbackMessage.text}</span>
            </div>
            <button onClick={() => setFeedbackMessage(null)} className="text-muted-foreground hover:text-foreground">
              <Icons.close className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === 'topology' ? (
          isLoading ? (
            <div className="w-full h-[720px] rounded-2xl border bg-card/40 p-6 space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-40 w-72 rounded-xl" />
                <Skeleton className="h-40 w-72 rounded-xl" />
                <Skeleton className="h-40 w-72 rounded-xl" />
              </div>
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ) : rawNodes.length === 0 ? (
            <div className="w-full h-[320px] rounded-2xl border bg-card flex flex-col items-center justify-center gap-2 text-center px-6">
              <Icons.network className="w-8 h-8 text-muted-foreground opacity-50" />
              <h4 className="text-xs font-semibold text-foreground">Ağ topolojisi henüz oluşmadı</h4>
              <p className="text-[11px] text-muted-foreground max-w-sm">
                Merkez hub ile eşleşmiş bir şube olmadığı için harita boş görünüyor. Yeni bir cihazı{' '}
                <Link href="/dashboard/fleet" className="text-primary hover:underline font-medium">
                  filo sayfasından
                </Link>{' '}
                kaydedebilirsiniz.
              </p>
            </div>
          ) : (
            <div className="relative w-full h-[720px] rounded-2xl border bg-card overflow-hidden">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                attributionPosition="bottom-right"
                minZoom={0.2}
                maxZoom={1.5}
              >
                <Background color="var(--border)" gap={20} size={1} />
                <Controls className="!bg-card !border-border !rounded-xl overflow-hidden" />
                <MiniMap
                  nodeStrokeColor="var(--primary)"
                  nodeColor="var(--muted-foreground)"
                  className="!bg-card !border-border !rounded-xl"
                />
              </ReactFlow>

              {/* Lejant (harita açıklama kutusu) */}
              <div className="absolute bottom-4 left-4 p-3 bg-card border rounded-xl text-[11px] space-y-1.5 pointer-events-none">
                <span className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground block">Taşıma katmanı türleri</span>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-sky-600 rounded-full" />
                  <span className="font-medium text-foreground">Şifreli SD-WAN overlay (WireGuard)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-amber-500 rounded-full" />
                  <span className="font-medium text-foreground">Şubeler arası doğrudan köprü (mesh)</span>
                </div>
              </div>
            </div>
          )
        ) : (
          /* Köprü yönetim sekmesi */
          <div className="space-y-4">
            <div className="p-4 bg-muted/30 border rounded-2xl">
              <h3 className="text-sm font-semibold text-foreground mb-1">Şubeler arası doğrudan köprü rotaları (mesh VPN)</h3>
              <p className="text-xs text-muted-foreground">
                İki uç şube arasında merkez sunucu trafiğine yük bindirmeden doğrudan şifreli tünel bağlantıları ve statik rota politikaları oluşturun.
              </p>
            </div>

            {bridgesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="p-4 rounded-xl border bg-card space-y-3">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            ) : bridges.length === 0 ? (
              <div className="p-12 text-center border rounded-2xl bg-card space-y-3">
                <Icons.swap className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
                <h4 className="text-xs font-semibold text-foreground">Tesis edilmiş şube köprüsü bulunmuyor</h4>
                <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                  Şubeler arasındaki yerel ağ trafiği varsayılan olarak merkez SD-WAN ağ geçidi üzerinden yönlendirilir.
                </p>
                <button
                  onClick={() => setIsBridgeModalOpen(true)}
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg shadow-sm"
                >
                  İlk köprüyü tesis et
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bridges.map((b) => (
                  <div key={b.id} className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{b.name || 'Şube köprüsü'}</span>
                      <button
                        onClick={() => setBridgeToDelete(b)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Köprüyü kaldır"
                      >
                        <Icons.trash className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-muted/40 p-2.5 rounded-lg">
                      <div>
                        <span className="text-[9px] text-muted-foreground uppercase block font-sans">Kaynak şube</span>
                        <span className="font-semibold text-foreground">{b.source_name || b.source_device_id}</span>
                        <span className="text-[10px] text-muted-foreground block">{b.source_subnet}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground uppercase block font-sans">Hedef şube</span>
                        <span className="font-semibold text-foreground">{b.target_name || b.target_device_id}</span>
                        <span className="text-[10px] text-muted-foreground block">{b.target_subnet}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Yeni köprü kurulum modalı */}
      {isBridgeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Icons.swap className="w-4 h-4 text-primary" />
                Yeni şubeler arası köprü tesis et
              </h3>
              <button onClick={() => setIsBridgeModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <Icons.close className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBridgeSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-muted-foreground font-medium">Köprü tanımı (opsiyonel)</label>
                <input
                  type="text"
                  value={bridgeCustomName}
                  onChange={(e) => setBridgeCustomName(e.target.value)}
                  placeholder="Örn: ARIOT - Netfix doğrudan tüneli"
                  className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">Kaynak ağ geçidi</label>
                  <select
                    value={sourceDevId}
                    onChange={(e) => setSourceDevId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                  >
                    <option value="">Seçiniz...</option>
                    {allDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name || d.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-muted-foreground font-medium">Hedef ağ geçidi</label>
                  <select
                    value={targetDevId}
                    onChange={(e) => setTargetDevId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                  >
                    <option value="">Seçiniz...</option>
                    {allDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name || d.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsBridgeModalOpen(false)}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground font-medium rounded-lg transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={createBridgeMutation.isPending}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg disabled:opacity-50"
                >
                  {createBridgeMutation.isPending ? 'Tesis ediliyor...' : 'Köprüyü başlat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Node'a tıklandığında cihazın Şube 360° detay modalını aç */}
      <DeviceDetailModal
        deviceId={selectedNode?.id ?? null}
        initialDevice={selectedNode}
        onClose={() => setSelectedNode(null)}
      />

      {/* Köprü silme onayı — yıkıcı bir eylem, tek tıkla geri alınamaz kaldırma artık yok */}
      <ConfirmModal
        isOpen={!!bridgeToDelete}
        onClose={() => setBridgeToDelete(null)}
        onConfirm={() => bridgeToDelete && deleteBridgeMutation.mutate(bridgeToDelete.id)}
        title="Köprüyü kaldır"
        description={`"${bridgeToDelete?.name || 'Bu köprü'}" kaldırılacak ve iki şube arasındaki doğrudan mesh rotası kesilecektir. Bu işlem geri alınamaz.`}
        confirmText="Evet, kaldır"
        variant="danger"
        isLoading={deleteBridgeMutation.isPending}
      />
    </PageContainer>
  );
}
