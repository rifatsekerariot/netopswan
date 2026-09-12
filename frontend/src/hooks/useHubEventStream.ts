import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface HubEvent {
  event_type: 'PeerStatusChanged' | 'WanLockStatusUpdated' | 'LiveSecurityEvent' | 'ThreatAlertTriggered';
  data: any;
}

export function useHubEventStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        eventSource = new EventSource('/api/events/stream');

        eventSource.onmessage = (e) => {
          try {
            const parsed: HubEvent = JSON.parse(e.data);
            if (!parsed || !parsed.event_type) return;

            switch (parsed.event_type) {
              case 'WanLockStatusUpdated':
                queryClient.invalidateQueries({ queryKey: ['fleet-templates'] });
                queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
                queryClient.invalidateQueries({ queryKey: ['fw-templates'] });
                queryClient.invalidateQueries({ queryKey: ['deviceDetail'] });
                break;

              case 'PeerStatusChanged':
                queryClient.invalidateQueries({ queryKey: ['fleet-devices'] });
                queryClient.invalidateQueries({ queryKey: ['sdwan-topology'] });
                queryClient.invalidateQueries({ queryKey: ['deviceDetail'] });
                break;


              case 'ThreatAlertTriggered':
              case 'LiveSecurityEvent':
                queryClient.invalidateQueries({ queryKey: ['threat-logs'] });
                queryClient.invalidateQueries({ queryKey: ['overview-stats'] });
                break;
            }
          } catch {
            // Ignore parse errors
          }
        };

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
          }
          // Reconnect after 5 seconds if connection drops
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch {
        // Fallback gracefully to standard polling if EventSource is unsupported
      }
    };

    connect();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [queryClient]);
}
