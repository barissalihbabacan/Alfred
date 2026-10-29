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

lines = [""]
lines += [f"  {GOLD}{row}{RESET}" for row in LOGO]
lines += [
    "",
    f"  {WHITE}Start the setup wizard / Kurulum sihirbazını başlat:{RESET}",
    "",
    f"  {INV}   {COMMAND}   {RESET}",
    "",
    f"  {DIM}Type or paste it below and press Enter. / Aşağıya yaz ya da yapıştır, Enter'a bas.{RESET}",
    f"  {DIM}Text too small? Settings (gear) > Text size, or Ctrl/Cmd and +.{RESET}",
    f"  {DIM}Yazı küçük mü? Ayarlar (dişli) > Text size, ya da Ctrl/Cmd ve +.{RESET}",
    "",
]

out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).with_name("welcome.txt")
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("ok")
