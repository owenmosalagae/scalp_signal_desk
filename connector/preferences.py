"""Local watchlist, Windows-protected pairing and opt-in startup."""
import ctypes
import json
import os
import subprocess
import sys
import tempfile
from ctypes import wintypes
from pathlib import Path


def data_directory():
    local = os.environ.get("LOCALAPPDATA")
    return Path(local) / "ScalpSignalDesk" if local else Path.home() / ".scalp-signal-desk"


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def load_profile():
    path = data_directory() / "watchlist.json"
    if not path.exists():
        return None
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(profile, dict):
            raise ValueError("Invalid profile")
        return profile
    except (ValueError, OSError) as error:
        raise ValueError("Saved watchlist could not be read. Run configure_windows.bat to replace it.") from error


def save_profile(profile):
    write_atomic(data_directory() / "watchlist.json", json.dumps(profile, indent=2).encode("utf-8"))


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _dpapi(data, decrypt=False):
    if os.name != "nt":
        raise OSError("Remembered pairing requires Windows Data Protection.")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    function.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    incoming = DataBlob(len(data), buffer)
    outgoing = DataBlob()
    # User-scoped protection. UI is disabled and no machine-wide flag is used.
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(outgoing.pbData, ctypes.c_void_p))


def load_pairing(site):
    path = data_directory() / "pairing.dat"
    if not path.exists():
        return None
    try:
        payload = json.loads(_dpapi(path.read_bytes(), decrypt=True))
        if payload.get("site") == site and isinstance(payload.get("token"), str) and payload["token"]:
            return payload["token"]
    except (OSError, ValueError, AttributeError):
        pass
    return None


def save_pairing(site, token):
    payload = json.dumps({"site": site, "token": token}).encode("utf-8")
    write_atomic(data_directory() / "pairing.dat", _dpapi(payload))


def forget_pairing():
    (data_directory() / "pairing.dat").unlink(missing_ok=True)


def acquire_instance_lock():
    if os.name != "nt":
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    ctypes.set_last_error(0)
    handle = kernel32.CreateMutexW(None, False, "Local\\ScalpSignalDeskConnector")
    error = ctypes.get_last_error()
    if not handle:
        raise ctypes.WinError(error)
    if error == 183:
        kernel32.CloseHandle(handle)
        raise RuntimeError("A connector is already running. Stop its window with Ctrl+C before starting another.")
    return handle


def release_instance_lock(handle):
    if handle is not None and os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.CloseHandle(handle)


def set_startup(script, enabled):
    if os.name != "nt" or not os.environ.get("APPDATA"):
        raise OSError("Automatic startup is available on Windows.")
    startup = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup"
    shortcut = startup / "Scalp Signal Desk.lnk"
    if not enabled:
        shortcut.unlink(missing_ok=True)
        return
    startup.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update({
        "SCALP_STARTUP_SHORTCUT": str(shortcut),
        "SCALP_STARTUP_PYTHON": sys.executable,
        "SCALP_STARTUP_ARGUMENTS": subprocess.list2cmdline(["-u", str(script.resolve())]),
        "SCALP_STARTUP_DIRECTORY": str(script.resolve().parent),
    })
    command = (
        "$ErrorActionPreference='Stop'; "
        "$shell=New-Object -ComObject WScript.Shell; "
        "$shortcut=$shell.CreateShortcut($env:SCALP_STARTUP_SHORTCUT); "
        "$shortcut.TargetPath=$env:SCALP_STARTUP_PYTHON; "
        "$shortcut.Arguments=$env:SCALP_STARTUP_ARGUMENTS; "
        "$shortcut.WorkingDirectory=$env:SCALP_STARTUP_DIRECTORY; "
        "$shortcut.WindowStyle=7; "
        "$shortcut.Description='Scalp Signal Desk MT5 connector'; "
        "$shortcut.Save()"
    )
    subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                   check=True, env=environment, capture_output=True, text=True, timeout=30)
