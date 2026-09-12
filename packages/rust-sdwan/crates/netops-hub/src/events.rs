use axum::response::sse::{Event, Sse};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "data")]
pub enum HubEvent {
    PeerStatusChanged {
        device_id: String,
        status: String,
    },
    WanLockStatusUpdated {
        device_id: String,
        is_locked_hw: bool,
    },
    LiveSecurityEvent {
        event: netops_proto::SecurityEvent,
    },
    ThreatAlertTriggered {
        alert: netops_proto::ThreatAlert,
    },
}

#[derive(Clone)]
pub struct HubEventBroadcaster {
    sender: broadcast::Sender<HubEvent>,
}

impl HubEventBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn publish(&self, event: HubEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HubEvent> {
        self.sender.subscribe()
    }
}

/// Axum Server-Sent Events (SSE) Uç Noktası Handler
pub async fn sse_events_handler(
    broadcaster: Arc<HubEventBroadcaster>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = broadcaster.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| match res {
        Ok(event) => {
            if let Ok(json_str) = serde_json::to_string(&event) {
                Some(Ok(Event::default().data(json_str)))
            } else {
                None
            }
        }
        Err(e) => {
            warn!("⚠️ SSE Broadcast Stream uyarısı: {}", e);
            None
        }
    });

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}
