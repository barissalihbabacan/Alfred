"""Writes .cloudshell/welcome.txt, which Cloud Shell prints when the setup button opens it."""
import pathlib
import sys

ESC = "\x1b"
GOLD = f"{ESC}[1;38;5;220m"
WHITE = f"{ESC}[1;97m"
DIM = f"{ESC}[2m"
INV = f"{ESC}[1;30;48;5;220m"
RESET = f"{ESC}[0m"

LOGO = [
    " █████  ██      ███████ ██████  ███████ ██████ ",
    "██   ██ ██      ██      ██   ██ ██      ██   ██",
    "███████ ██      █████   ██████  █████   ██   ██",
    "██   ██ ██      ██      ██   ██ ██      ██   ██",
    "██   ██ ███████ ██      ██   ██ ███████ ██████ ",
]
COMMAND = "bash .cloudshell/start.sh"

# One block per language: heading, paragraph, the command, then how to run it.
SECTIONS = [
    {
        "heading": "Welcome to Alfred Setup",
        "paragraph": [
            "This wizard installs your own Alfred in a Google Cloud project: it sets up",
            "the project, billing, Firebase, Firestore and your API keys, then builds",
            "and deploys the web app. It takes about 15 minutes; a billing account is",
            "required. Sign in or press Authorize if Cloud Shell asks.",
        ],
        "start": "Start the wizard:",
        "hint": [
            "Type or paste it below and press Enter.",
            "Text too small? Settings (gear) > Text size, or Ctrl/Cmd and +.",
        ],
    },
    {
        "heading": "Alfred Kurulumuna hoş geldin",
        "paragraph": [
            "Bu sihirbaz kendi Alfred'ini bir Google Cloud projesine kurar: projeyi,",
            "faturalandırmayı, Firebase'i, Firestore'u ve API anahtarlarını ayarlar,",
            "ardından web uygulamasını derleyip yayınlar. Yaklaşık 15 dakika sürer;",
            "bir faturalandırma hesabı gerekir. Cloud Shell isterse giriş yap ya da",
            "Authorize'a bas.",
        ],
        "start": "Sihirbazı başlat:",
        "hint": [
            "Aşağıya yaz ya da yapıştır, Enter'a bas.",
            "Yazı küçük mü? Ayarlar (dişli) > Text size, ya da Ctrl/Cmd ve +.",
        ],
    },
]

# Clear the screen first, as `clear` would: Cloud Shell prints the clone log and a
# timestamp before this file, which would push the logo out of line.
CLEAR = f"{ESC}[H{ESC}[2J{ESC}[3J"

lines = [CLEAR]
lines += [f"  {GOLD}{row}{RESET}" for row in LOGO]
for index, section in enumerate(SECTIONS):
    if index:
        lines += ["", f"  {DIM}{'─' * 76}{RESET}"]
    lines += ["", f"  {WHITE}{section['heading']}{RESET}", ""]
    lines += [f"  {row}" for row in section["paragraph"]]
    lines += ["", f"  {WHITE}{section['start']}{RESET}  {INV}   {COMMAND}   {RESET}"]
    lines += [f"  {DIM}{row}{RESET}" for row in section["hint"]]
lines.append("")

out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).with_name("welcome.txt")
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("ok")
