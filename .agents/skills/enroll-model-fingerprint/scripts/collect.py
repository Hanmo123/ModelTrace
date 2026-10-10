"""Collect one ModelTrace reference suite into a resumable staging file."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlsplit

REPOSITORY = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY))

from challenge_suite import fingerprint_suite
from enrollment import append_rows, completion_url, make_row, upstream_user_agent
from fingerprint import parse_numbers

RETRYABLE = {408, 429, 500, 502, 503, 504}


class CollectionError(Exception):
    pass


class FatalAPIError(CollectionError):
    pass


def compose_prompt(task: dict) -> str:
    if task["user_prefix"]:
        return task["user_prefix"] + "\n\nFinal task:\n" + task["prompt"]
    return task["prompt"]


def quality_issues(text: str, expected: int) -> list[str]:
    numbers = parse_numbers(text)
    raw = [int(value) for value in re.findall(r"\d+", text)]
    issues = []
    if not max(80, (expected * 55 + 99) // 100) <= len(numbers):
        issues.append("insufficient numbers")
    if not 0.8 <= len(numbers) / expected <= 1.2:
        issues.append(f"count outside 80%-120%: {len(numbers)}/{expected}")
    if raw != numbers:
        issues.append("extraneous or out-of-range numbers")
    if re.search(r"(?<![\w\d])[+-]\d|\d\.\d|\d[eE][+-]?\d", text):
        issues.append("signed, decimal or exponential values")
    if len(set(numbers)) < 20:
        issues.append("fewer than 20 distinct values")
    if numbers and max(Counter(numbers).values()) / len(numbers) > 0.15:
        issues.append("one value exceeds 15%")
    seen = set()
    for index in range(len(numbers) - 11):
        block = tuple(numbers[index:index + 12])
        if block in seen:
            issues.append("repeated 12-value block")
            break
        seen.add(block)
    run = 2
    for index in range(2, len(numbers)):
        run = run + 1 if numbers[index] - numbers[index - 1] == numbers[index - 1] - numbers[index - 2] else 2
        if run >= 10:
            issues.append("10-value arithmetic progression")
            break
    return issues


def validate_saved(row: dict, task: dict, args: argparse.Namespace) -> None:
    expected = {
        "source": args.model_label,
        "model_id": args.model_label,
        "bank_id": args.family,
        "family_id": args.family,
        "family_name": args.family_name,
        "provider": args.provider,
        "api_model": args.api_model,
        "api_base_url": args.base_url,
        "condition_id": task["condition"],
        "wrapper_transport": task["transport"],
        "requested_count": task["expected_count"],
        "prompt": compose_prompt(task),
        "base_prompt": task["prompt"],
        "system_prompt": task["system"],
        "user_prefix": task["user_prefix"],
        "temperature": args.temperature if args.temperature is not None else "provider_default",
        "strict_valid": True,
        "pattern_valid": True,
    }
    for key, value in expected.items():
        if row.get(key) != value:
            raise CollectionError(f"{task['challenge_id']}: saved {key} does not match this run")
    if row.get("parsed_count") != len(parse_numbers(row["text"])):
        raise CollectionError(f"{task['challenge_id']}: stale parsed_count")
    issues = quality_issues(row["text"], task["expected_count"])
    if issues:
        raise CollectionError(f"{task['challenge_id']}: " + "; ".join(issues))
    if row.get("finish_reason") in {"length", "content_filter"}:
        raise CollectionError(f"{task['challenge_id']}: truncated or filtered response")


def load_checkpoint(args: argparse.Namespace, suite: dict) -> dict[str, dict]:
    saved = {}
    row_ids = set()
    outputs = set()
    if not args.output.exists():
        return saved
    for line in args.output.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        challenge_id = row.get("challenge_id")
        if challenge_id not in suite or challenge_id in saved:
            raise CollectionError("Unknown or duplicate challenge in staging file")
        validate_saved(row, suite[challenge_id], args)
        if not row.get("row_id") or row["row_id"] in row_ids or row["text"] in outputs:
            raise CollectionError("Missing row ID, duplicate row ID or duplicate output")
        row_ids.add(row["row_id"])
        outputs.add(row["text"])
        saved[challenge_id] = row
    return saved


def collect_task(task: dict, args: argparse.Namespace, api_key: str, stopped: threading.Event) -> dict:
    messages = ([{"role": "system", "content": task["system"]}] if task["system"] else [])
    messages.append({"role": "user", "content": compose_prompt(task)})
    body = {"model": args.api_model, "messages": messages, "stream": False}
    if args.temperature is not None:
        body["temperature"] = args.temperature
    headers = {
        "Authorization": "Bearer " + api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": upstream_user_agent(),
    }
    for attempt in range(1, 4):
        if stopped.is_set():
            raise CollectionError("cancelled after a fatal API error")
        started = time.monotonic()
        try:
            request = urllib.request.Request(
                completion_url(args.base_url), data=json.dumps(body).encode(), headers=headers, method="POST"
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                payload = json.load(response)
            choice = payload["choices"][0]
            text = choice["message"].get("content")
            if isinstance(text, list):
                text = "".join(part.get("text", "") for part in text)
            if not isinstance(text, str):
                raise CollectionError("response has no text content")
            row = make_row(
                model_label=args.model_label, text=text, condition=task["condition"],
                challenge_id=task["challenge_id"], expected_count=task["expected_count"],
                temperature=args.temperature if args.temperature is not None else "provider_default",
                bank_id=args.family, wrapper_transport=task["transport"], provider=args.provider,
                prompt=compose_prompt(task), base_prompt=task["prompt"],
                system_prompt=task["system"], user_prefix=task["user_prefix"],
            )
            row.update({
                "family_id": args.family, "family_name": args.family_name,
                "api_model": args.api_model, "api_base_url": args.base_url,
                "response_model": payload.get("model"), "response_id": payload.get("id"),
                "finish_reason": choice.get("finish_reason"), "usage": payload.get("usage"),
                "request_seconds": round(time.monotonic() - started, 3),
                "config_id": "reference-collection", "pattern_valid": not quality_issues(text, task["expected_count"]),
                "collection_attempt": attempt,
            })
            validate_saved(row, task, args)
            return row
        except urllib.error.HTTPError as error:
            # Never print headers or the provider's error body; either can contain credentials.
            reason = f"HTTP {error.code}"
            error.close()
            if error.code not in RETRYABLE:
                stopped.set()
                raise FatalAPIError(reason) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            reason = "network failure or timeout"
        except (CollectionError, ValueError, KeyError, IndexError, TypeError) as error:
            reason = str(error) if isinstance(error, CollectionError) else "invalid completion payload"
        print(f"{task['challenge_id']} attempt {attempt}/3: {reason}", flush=True)
        if attempt < 3:
            stopped.wait(attempt)
    raise CollectionError(f"{task['challenge_id']}: failed after 3 attempts")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-model", required=True, help="Exact request model, including routing suffixes")
    parser.add_argument("--model-label", required=True, help="Stable classifier label without routing suffixes")
    parser.add_argument("--family", required=True)
    parser.add_argument("--family-name", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--output", required=True, type=Path, help="Staging JSONL, not a canonical family reference")
    parser.add_argument("--temperature", type=float)
    parser.add_argument("--api-key-env", default="MODELTRACE_API_KEY")
    parser.add_argument("--api-key-stdin", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--verify-only", action="store_true", help="Validate all 36 saved rows without API calls")
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    url = urlsplit(args.base_url)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error("base URL must be an API root without credentials, query or fragment")
    suite = {task["challenge_id"]: task for task in fingerprint_suite()}
    if not args.verify_only and args.output.resolve().parent == (REPOSITORY / "data").resolve():
        parser.error("collect into a staging directory; import into data only after verification")
    if args.output.exists() and not (args.resume or args.verify_only):
        parser.error("output exists; use --resume to validate and continue it")
    saved = load_checkpoint(args, suite)
    if not args.verify_only and len(saved) < len(suite):
        api_key = sys.stdin.readline().strip() if args.api_key_stdin else os.environ.get(args.api_key_env, "").strip()
        if not api_key and sys.stdin.isatty():
            api_key = getpass.getpass("API key: ")
        if not api_key:
            parser.error("supply the API key through the named environment variable or --api-key-stdin")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        stopped = threading.Event()
        pending = [task for key, task in suite.items() if key not in saved]
        texts = {row["text"] for row in saved.values()}

        def save(row: dict) -> None:
            if row["text"] in texts:
                raise CollectionError(f"{row['challenge_id']}: duplicate output; not saved")
            append_rows([row], args.output)
            saved[row["challenge_id"]] = row
            texts.add(row["text"])
            print(f"Accepted {len(saved)}/{len(suite)} {row['challenge_id']} numbers={row['parsed_count']}", flush=True)

        # The first real challenge is the connectivity check and is retained as training data.
        save(collect_task(pending[0], args, api_key, stopped))
        errors = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(collect_task, task, args, api_key, stopped) for task in pending[1:]]
            try:
                for future in as_completed(futures):
                    try:
                        save(future.result())
                    except CollectionError as error:
                        errors.append(str(error))
            except BaseException:
                stopped.set()
                for future in futures:
                    future.cancel()
                raise
        if errors:
            print(json.dumps({"status": "incomplete", "accepted": len(saved), "errors": errors}), flush=True)
            return 1
    if len(saved) != len(suite):
        raise CollectionError(f"Incomplete suite: {len(saved)}/{len(suite)}")
    print(json.dumps({
        "status": "complete", "accepted": len(saved),
        "valid_numbers": sum(row["parsed_count"] for row in saved.values()),
        "environments": dict(Counter(row["condition_id"] for row in saved.values())),
        "response_models": sorted({str(row.get("response_model")) for row in saved.values()}),
    }, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CollectionError, ValueError) as error:
        print(f"Collection stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
