"""Persistence boundaries plus native Windows checks when run on Windows."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "connector"))
import preferences


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"LOCALAPPDATA": self.directory.name, "APPDATA": self.directory.name})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def test_only_encrypted_output_is_written(self):
        with patch.object(preferences, "_dpapi", return_value=b"protected fixture") as encrypt:
            preferences.save_pairing("https://fixture.example", "fixture-secret")
        self.assertEqual((preferences.data_directory() / "pairing.dat").read_bytes(), b"protected fixture")
        payload = json.loads(encrypt.call_args.args[0])
        self.assertEqual(payload["token"], "fixture-secret")

    def test_encryption_failure_does_not_write_plaintext(self):
        with patch.object(preferences, "_dpapi", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError):
                preferences.save_pairing("https://fixture.example", "fixture-secret")
        self.assertFalse((preferences.data_directory() / "pairing.dat").exists())

    def test_saved_pairing_is_bound_to_its_site(self):
        preferences.data_directory().mkdir()
        (preferences.data_directory() / "pairing.dat").write_bytes(b"fixture")
        payload = json.dumps({"site": "https://fixture.example", "token": "fixture-secret"}).encode()
        with patch.object(preferences, "_dpapi", return_value=payload):
            self.assertEqual(preferences.load_pairing("https://fixture.example"), "fixture-secret")
            self.assertIsNone(preferences.load_pairing("https://other.example"))
        preferences.forget_pairing()
        self.assertIsNone(preferences.load_pairing("https://fixture.example"))

    def test_failed_atomic_replace_keeps_the_previous_profile(self):
        preferences.save_profile({"symbols": ["Step Index"]})
        path = preferences.data_directory() / "watchlist.json"
        original = path.read_bytes()
        with patch.object(preferences.os, "replace", side_effect=OSError("fixture failure")):
            with self.assertRaises(OSError):
                preferences.save_profile({"symbols": ["Boom 500 Index"]})
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual([p.name for p in path.parent.iterdir()], ["watchlist.json"])

    @unittest.skipUnless(os.name == "nt", "Requires native Windows DPAPI")
    def test_native_windows_encryption_round_trip(self):
        payload = b"private test credential"
        encrypted = preferences._dpapi(payload)
        self.assertNotEqual(payload, encrypted)
        self.assertEqual(preferences._dpapi(encrypted, decrypt=True), payload)

    @unittest.skipUnless(os.name == "nt", "Requires native Windows mutex")
    def test_native_windows_duplicate_instance_lock(self):
        handle = preferences.acquire_instance_lock()
        try:
            with self.assertRaisesRegex(RuntimeError, "already running"):
                preferences.acquire_instance_lock()
        finally:
            preferences.release_instance_lock(handle)
        handle = preferences.acquire_instance_lock()
        preferences.release_instance_lock(handle)

    @unittest.skipUnless(os.name == "nt", "Requires Windows shortcut support")
    def test_native_windows_startup_shortcut_can_be_removed(self):
        script = Path(self.directory.name) / "folder with spaces" / "connector.py"
        script.parent.mkdir()
        script.write_text("# fixture only")
        preferences.set_startup(script, True)
        shortcut = Path(self.directory.name) / "Microsoft/Windows/Start Menu/Programs/Startup/Scalp Signal Desk.lnk"
        self.assertTrue(shortcut.is_file())
        preferences.set_startup(script, False)
        self.assertFalse(shortcut.exists())


if __name__ == "__main__":
    unittest.main()
