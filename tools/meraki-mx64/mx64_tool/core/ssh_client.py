import paramiko
import scp
import time
from pathlib import Path
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

class OpenWrtSSHClient:
    def __init__(self, host: str = "192.168.1.1", user: str = "root", password: str = "", port: int = 22):
        self.host = host
        self.user = user
        self.password = password
        self.port = port
        self.client = None

    def connect(self, max_retries: int = 10, retry_delay: int = 3) -> bool:
        log_info(f"OpenWrt SSH bağlantısı bekleniyor ({self.host}:{self.port})...")
        for i in range(max_retries):
            try:
                self.client = paramiko.SSHClient()
                self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                self.client.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.user,
                    password=self.password,
                    timeout=5,
                    look_for_keys=False,
                    allow_agent=False
                )
                log_success("OpenWrt SSH oturumu başarıyla açıldı!")
                return True
            except Exception as e:
                time.sleep(retry_delay)
        log_error("SSH bağlantısı zaman aşımına uğradı.")
        return False

    def upload_file(self, local_path: Path, remote_path: str = "/tmp/"):
        if not self.client:
            raise ConnectionError("SSH bağlantısı yok.")
        log_info(f"Dosya cihaza yükleniyor: {local_path.name} -> {remote_path}")
        with scp.SCPClient(self.client.get_transport()) as scp_client:
            scp_client.put(str(local_path), remote_path)
        log_success(f"{local_path.name} başarıyla yüklendi.")

    def run_sysupgrade(self, remote_file_path: str):
        if not self.client:
            raise ConnectionError("SSH bağlantısı yok.")
        log_warning(f"Sysupgrade başlatılıyor: {remote_file_path}")
        cmd = f"sysupgrade -v -n {remote_file_path}"
        stdin, stdout, stderr = self.client.exec_command(cmd)
        log_info("Sysupgrade komutu gönderildi. Cihaz flash yazıp yeniden başlayacaktır.")

    def close(self):
        if self.client:
            self.client.close()
            self.client = None
