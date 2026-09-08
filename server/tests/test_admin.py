"""Isolated admin boundary tests; no database, credentials or model calls."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.admin import hash_password, verify_password
from app.model_config import public_version, validate_model_url


class AdminCryptoTests(unittest.TestCase):
    def test_password_hash_is_salted_and_verifiable(self):
        first = hash_password("a-private-admin-password")
        second = hash_password("a-private-admin-password")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password("a-private-admin-password", first))
        self.assertFalse(verify_password("wrong-password", first))
        self.assertNotIn("a-private-admin-password", first)

    def test_password_policy_and_model_url_policy(self):
        with self.assertRaises(ValueError):
            hash_password("short")
        self.assertEqual(validate_model_url("https://provider.example/v1/"), "https://provider.example/v1")
        self.assertEqual(validate_model_url("http://127.0.0.1:9000/v1"), "http://127.0.0.1:9000/v1")
        for url in ("http://provider.example/v1", "https://user:pass@provider.example/v1", "https://provider.example/v1?key=secret", "https://provider.example/v1#secret"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_model_url(url)

    def test_public_version_never_contains_secret(self):
        row = {"id": uuid4(), "parent_version_id": None, "base_url": "https://provider.example/v1",
               "model_name": "model", "timeout_seconds": 90, "secret_version_id": uuid4(),
               "created_at": datetime.now(timezone.utc), "ciphertext": "encrypted-secret"}
        value = public_version(row)
        self.assertTrue(value["has_key"])
        self.assertNotIn("ciphertext", value)
        self.assertNotIn("secret", str(value))

    def test_public_version_accepts_active_state_projection(self):
        row = {"id": uuid4(), "active_version_id": uuid4(), "parent_version_id": None,
               "base_url": "https://provider.example/v1", "model_name": "model",
               "timeout_seconds": 90, "secret_version_id": None,
               "created_at": datetime.now(timezone.utc)}
        value = public_version(row)
        self.assertEqual(value["id"], str(row["id"]))
        self.assertIsNone(value["parent_version_id"])


if __name__ == "__main__":
    unittest.main()
