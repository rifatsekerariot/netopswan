from rich.console import Console
from rich.theme import Theme

custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "danger": "bold red",
    "success": "bold green",
    "highlight": "magenta",
})

console = Console(theme=custom_theme)

def log_info(msg: str):
    console.print(f"[info]ℹ [/info] {msg}")

def log_success(msg: str):
    console.print(f"[success]✔ [/success] {msg}")

def log_warning(msg: str):
    console.print(f"[warning]⚠ [/warning] {msg}")

def log_error(msg: str):
    console.print(f"[danger]✖ [/danger] {msg}")
