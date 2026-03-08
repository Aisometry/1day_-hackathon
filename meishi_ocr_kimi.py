"""
名刺OCR — Kimi K2.5 via Unbound (getunbound.ai)
Outputs raw JSON to stdout for piping to other programs.
"""

import base64
import json
import os
import re
import sys
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

UNBOUND_API_KEY = os.getenv("UNBOUND_API_KEY")
if not UNBOUND_API_KEY:
    print("UNBOUND_API_KEY not found in .env", file=sys.stderr)
    sys.exit(1)

BASE_URL = os.getenv("UNBOUND_BASE_URL", "https://api.getunbound.ai/v1")
MODEL = os.getenv("KIMI_MODEL", "fireworks-ai/kimi-k2p5")
MAX_TOKENS = 4096
TIMEOUT_SEC = 30.0

SUPPORTED_FORMATS = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
}

EXTRACTION_PROMPT = """\
You are a business card (名刺) OCR specialist.

Analyze the provided business card image and extract the following fields.
The card may be in Japanese, English, or bilingual.

Respond with ONLY a valid JSON object — no markdown, no explanation, no thinking.

{
  "name": "Full name. Prefer kanji if available, add romaji in parentheses if present.",
  "company": "Company or organization name",
  "title": "Job title or position",
  "email": "Email address",
  "phone": "Phone number (include country code if visible)"
}

If a field is not present on the card, set it to null.
"""


def encode_image(path: str) -> tuple[str, str]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    suffix = p.suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported format '{suffix}'")
    raw = p.read_bytes()
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("Image exceeds 20 MB limit")
    return base64.standard_b64encode(raw).decode("utf-8"), SUPPORTED_FORMATS[suffix]


def extract_json(raw_text: str) -> dict:
    """Extract JSON object from a response that may contain chain-of-thought."""
    # 1) Try markdown-fenced JSON blocks (last one wins)
    fenced = re.findall(r"```(?:json)?\s*\n(\{.*?\})\s*\n?```", raw_text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced[-1])
        except json.JSONDecodeError:
            pass

    # 2) Fallback: find the last parseable top-level JSON object
    for m in reversed(list(re.finditer(r"\{", raw_text))):
        candidate = raw_text[m.start():]
        depth, end = 0, None
        for i, ch in enumerate(candidate):
            if ch == "{": depth += 1
            elif ch == "}": depth -= 1
            if depth == 0:
                end = i + 1
                break
        if end:
            try:
                return json.loads(candidate[:end])
            except json.JSONDecodeError:
                continue

    raise ValueError("No JSON object found in response")


def extract_card(image_path: str) -> dict:
    b64_data, media_type = encode_image(image_path)

    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.6,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64_data}"}},
                {"type": "text", "text": EXTRACTION_PROMPT},
            ],
        }],
    }

    headers = {
        "Authorization": f"Bearer {UNBOUND_API_KEY}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=TIMEOUT_SEC) as client:
        resp = client.post(f"{BASE_URL}/chat/completions", json=payload, headers=headers)

    if resp.status_code != 200:
        raise RuntimeError(f"API error {resp.status_code}: {resp.text[:500]}")

    raw_text = resp.json()["choices"][0]["message"]["content"]
    return extract_json(raw_text)


def main():
    if len(sys.argv) < 2:
        print("Usage: python meishi_ocr_kimi.py <image_path> [image_path2 ...]", file=sys.stderr)
        sys.exit(1)

    paths = sys.argv[1:]

    if len(paths) == 1:
        result = extract_card(paths[0])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        results = []
        for p in paths:
            try:
                results.append({"file": p, **extract_card(p)})
            except Exception as e:
                results.append({"file": p, "error": str(e)})
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()