import http.server
import socketserver
import threading
from pathlib import Path
from mx64_tool.utils.logger import log_info, log_success, log_error

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Konsolu sessiz tut
        pass

class PayloadHTTPServer:
    def __init__(self, serve_dir: Path, port: int = 8000):
        self.serve_dir = serve_dir
        self.port = port
        self.server = None
        self.thread = None

    def start(self):
        handler = lambda *args, **kwargs: CustomHandler(*args, directory=str(self.serve_dir), **kwargs)
        # Portu hızlıca yeniden kullanabilmek için
        socketserver.TCPServer.allow_reuse_address = True
        try:
            self.server = socketserver.TCPServer(("", self.port), handler)
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()
            log_success(f"Yerel Payload HTTP Sunucusu başlatıldı: http://192.168.1.2:{self.port}/ ({self.serve_dir.name})")
        except Exception as e:
            log_error(f"HTTP sunucusu başlatılamadı: {e}")
            raise

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            log_info("Payload HTTP Sunucusu kapatıldı.")
