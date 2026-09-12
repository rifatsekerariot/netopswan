import hashlib
from pathlib import Path
from rich.console import Console

console = Console()

def calculate_sha256(filepath: Path) -> str:
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

def verify_file(filepath: Path, expected_hash: str) -> bool:
    if not filepath.exists():
        return False
    current_hash = calculate_sha256(filepath)
    return current_hash.lower() == expected_hash.lower()
