"""Offline checks for request routing, retry limits, checkpoints and credential handling."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from concurrent.futures import Future
from pathlib import Path
import random
import sys
import tempfile
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "collect.py"
spec = importlib.util.spec_from_file_location("fingerprint_collection", SCRIPT)
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)


class NoDelayEvent:
    def __init__(self):
        self.stopped = False

    def is_set(self):
        return self.stopped

    def set(self):
        self.stopped = True

    def wait(self, timeout):
        return self.stopped


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / "reference.jsonl"
        self.tasks = collect.fingerprint_suite()
        self.texts = {
            collect.compose_prompt(task): json.dumps(random.Random(index).sample(range(1, 356), task["expected_count"]))
            for index, task in enumerate(self.tasks)
        }
        self.argv = [
            str(SCRIPT), "--base-url", "https://example.test/api/v1",
            "--api-model", "test-model::only=Provider,nofallback", "--model-label", "test-model",
            "--family", "test", "--family-name", "Test", "--provider", "offline-fixture",
            "--output", str(self.output),
        ]
        self.requests = []
        self.log = io.StringIO()

    def respond(self, request, timeout):
        self.assertEqual(request.full_url, "https://example.test/api/v1/chat/completions")
        self.assertEqual(timeout, 240)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-key")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "test-model::only=Provider,nofallback")
        self.assertNotIn("temperature", body)
        self.assertFalse(body["stream"])
        self.requests.append(body)
        prompt = body["messages"][-1]["content"]
        return io.BytesIO(json.dumps({
            "id": "offline-response", "model": body["model"],
            "choices": [{"message": {"content": self.texts[prompt]}, "finish_reason": "stop"}],
            "usage": {"total_tokens": 1},
        }).encode())

    def run_main(self, *extra, responder=None, key="test-only-key"):
        with patch.object(sys, "argv", [*self.argv, *extra]), patch.dict(os.environ, {"MODELTRACE_API_KEY": key}), \
             patch.object(collect.urllib.request, "urlopen", side_effect=responder or self.respond), \
             contextlib.redirect_stdout(self.log), contextlib.redirect_stderr(self.log):
            return collect.main()

    def saved_rows(self):
        return [json.loads(line) for line in self.output.read_text().splitlines()]

    def test_complete_suite_preserves_prompts_routes_and_keeps_credentials_out(self):
        self.assertEqual(self.run_main(), 0)
        rows = self.saved_rows()
        self.assertEqual(len(rows), 36)
        self.assertEqual(len(self.requests), 36)
        self.assertEqual(len({row["challenge_id"] for row in rows}), 36)
        self.assertNotIn("test-only-key", self.output.read_text() + self.log.getvalue())
        for body in self.requests:
            task = next(task for task in self.tasks if collect.compose_prompt(task) == body["messages"][-1]["content"])
            system = [message["content"] for message in body["messages"] if message["role"] == "system"]
            self.assertEqual(system, [task["system"]] if task["system"] else [])
        self.assertEqual(self.run_main("--verify-only", responder=lambda *args, **kwargs: self.fail("network in verification"), key=""), 0)

    def test_interrupt_cancels_all_queued_tasks_and_keeps_first_checkpoint(self):
        futures = [Future() for _ in range(35)]
        with patch.object(collect, "ThreadPoolExecutor") as executor, \
             patch.object(collect, "as_completed", side_effect=KeyboardInterrupt):
            pool = executor.return_value.__enter__.return_value
            pool.submit.side_effect = futures
            with self.assertRaises(KeyboardInterrupt):
                self.run_main()
            stopped = pool.submit.call_args.args[-1]
        executor.assert_called_once_with(max_workers=2)
        self.assertTrue(stopped.is_set())
        self.assertTrue(all(future.cancelled() for future in futures))
        self.assertEqual(len(self.saved_rows()), 1)
        self.assertEqual(len(self.requests), 1)

    def test_key_can_arrive_through_stdin_without_environment_storage(self):
        with patch.object(sys, "stdin", io.StringIO("test-only-key\n")):
            self.assertEqual(self.run_main("--api-key-stdin", key=""), 0)
        self.assertNotIn("test-only-key", self.output.read_text() + self.log.getvalue())

    def test_resume_requests_only_missing_challenges(self):
        self.assertEqual(self.run_main(), 0)
        completed = self.saved_rows()[:3]
        self.output.write_text("".join(json.dumps(row) + "\n" for row in completed))
        self.requests.clear()
        self.assertEqual(self.run_main("--resume"), 0)
        self.assertEqual(len(self.requests), 33)
        self.assertTrue({row["row_id"] for row in completed} <= {row["row_id"] for row in self.saved_rows()})
        self.assertEqual(self.run_main("--resume", responder=lambda *args, **kwargs: self.fail("complete resume issued a request"), key=""), 0)

    def test_conflicting_resume_and_duplicate_challenge_are_rejected_before_network(self):
        self.run_main()
        rows = self.saved_rows()
        with self.assertRaises(collect.CollectionError):
            self.run_main("--resume", "--family-name", "Different", responder=lambda *args, **kwargs: self.fail("network before identity validation"))
        self.output.write_text(json.dumps(rows[0]) + "\n" + json.dumps(rows[0]) + "\n")
        with self.assertRaises(collect.CollectionError):
            self.run_main("--resume", responder=lambda *args, **kwargs: self.fail("network with duplicate checkpoint"))

    def test_incomplete_verification_fails_without_network(self):
        self.output.touch()
        with self.assertRaises(collect.CollectionError):
            self.run_main("--verify-only", responder=lambda *args, **kwargs: self.fail("network during verification"), key="")

    def test_authentication_failure_stops_after_first_challenge(self):
        failure = urllib.error.HTTPError("https://example.test", 401, "Unauthorized", {}, io.BytesIO(b"test-only-key"))
        with self.assertRaises(collect.FatalAPIError), patch.object(collect.urllib.request, "urlopen", side_effect=failure) as request:
            self.run_main(responder=request)
        self.assertEqual(request.call_count, 1)
        self.assertFalse(self.output.exists())
        self.assertNotIn("test-only-key", self.log.getvalue())

    def task_args(self):
        return SimpleNamespace(base_url="https://example.test/api/v1", api_model="test-model::only=Provider,nofallback",
                               model_label="test-model", family="test", family_name="Test", provider="offline-fixture", temperature=None)

    def test_transient_and_invalid_answers_share_a_three_attempt_budget(self):
        calls = 0

        def responder(request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise urllib.error.HTTPError(request.full_url, 429, "Rate limit", {}, io.BytesIO())
            if calls == 2:
                return io.BytesIO(json.dumps({"choices": [{"message": {"content": "1 2 3"}, "finish_reason": "stop"}]}).encode())
            return self.respond(request, timeout)

        with patch.object(collect.urllib.request, "urlopen", side_effect=responder), contextlib.redirect_stdout(self.log):
            row = collect.collect_task(self.tasks[0], self.task_args(), "test-only-key", NoDelayEvent())
        self.assertEqual(calls, 3)
        self.assertEqual(row["collection_attempt"], 3)

    def test_invalid_answers_exhaust_budget(self):
        response = {"choices": [{"message": {"content": "1 2 3"}, "finish_reason": "stop"}]}
        with patch.object(collect.urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(json.dumps(response).encode())) as request, \
             contextlib.redirect_stdout(self.log), self.assertRaises(collect.CollectionError):
            collect.collect_task(self.tasks[0], self.task_args(), "test-only-key", NoDelayEvent())
        self.assertEqual(request.call_count, 3)

    def test_pattern_and_numeric_rejections(self):
        self.assertIn("10-value arithmetic progression", collect.quality_issues(json.dumps(list(range(1, 219))), 218))
        block = random.Random(99).sample(range(1, 356), 100)
        self.assertIn("repeated 12-value block", collect.quality_issues(json.dumps(block * 2), 218))
        self.assertIn("signed, decimal or exponential values", collect.quality_issues("-1, 2.5, 1e2", 218))
        self.assertIn("extraneous or out-of-range numbers", collect.quality_issues("400, 1, 2", 218))


if __name__ == "__main__":
    unittest.main()
