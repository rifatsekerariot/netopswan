use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use tracing::warn;


pub type CommandSender = oneshot::Sender<netops_proto::DiagnosticCommandResponse>;
pub type CommandReceiver = oneshot::Receiver<netops_proto::DiagnosticCommandResponse>;

#[derive(Clone, Default)]
pub struct CommandDispatcher {
    pending: Arc<RwLock<HashMap<String, CommandSender>>>,
}

impl CommandDispatcher {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Yeni bir asenkron komut için oneshot kanalı kaydeder
    pub async fn register(&self, command_id: String) -> CommandReceiver {
        let (tx, rx) = oneshot::channel();
        self.pending.write().await.insert(command_id, tx);
        rx
    }

    /// Şubeden yanıt geldiğinde bekleyen kanala anında non-blocking aktarır
    pub async fn dispatch(&self, response: netops_proto::DiagnosticCommandResponse) -> bool {
        if let Some(tx) = self.pending.write().await.remove(&response.command_id) {
            let _ = tx.send(response);
            true
        } else {
            warn!("⚠️ Bekleyen komut kanalı bulunamadı veya zaman aşımına uğramış: {}", response.command_id);
            false
        }
    }
}
