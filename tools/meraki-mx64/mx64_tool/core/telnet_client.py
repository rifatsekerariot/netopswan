import telnetlib
import time
import re
from typing import Optional, Tuple
from mx64_tool.utils.logger import log_info, log_success, log_warning, log_error

class MerakiTelnetClient:
    def __init__(self, host: str = "192.168.1.1", port: int = 23, timeout: int = 10):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.tn: Optional[telnetlib.Telnet] = None

    def connect(self) -> bool:
        try:
            log_info(f"Telnet bağlantısı kuruluyor ({self.host}:{self.port})...")
            self.tn = telnetlib.Telnet(self.host, self.port, timeout=self.timeout)
            time.sleep(1)
            # Enter göndererek prompt'u al
            self.tn.write(b"\n")
            time.sleep(0.5)
            log_success("Telnet oturumu başarıyla açıldı.")
            return True
        except Exception as e:
            log_error(f"Telnet bağlantı hatası: {e}")
            return False

    def execute_command(self, cmd: str, wait_seconds: float = 1.0) -> str:
        if not self.tn:
            raise ConnectionError("Telnet oturumu aktif değil.")
        
        self.tn.write(cmd.encode("ascii") + b"\n")
        time.sleep(wait_seconds)
        output = self.tn.read_very_eager().decode("utf-8", errors="ignore")
        return output.strip()

    def close(self):
        if self.tn:
            try:
                self.tn.close()
            except Exception:
                pass
            self.tn = None
            log_info("Telnet bağlantısı sonlandırıldı.")
