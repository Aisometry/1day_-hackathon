"""
S-203: 名刺 → Person + Company 並行エンリッチメント
=====================================================
① asyncio.gather で person / company enrichment を並行実行
② 各完了時に SSE (Server-Sent Events) 形式で進捗を stdout に push
③ 片方失敗時も partial 結果で続行
④ タイムアウト 15秒

Usage:
  python meishi_ocr_kimi.py card.jpeg | python enrich_all.py
  echo '{"name":"田中太郎","company":"Toyota","email":"tanaka@toyota.co.jp"}' | python enrich_all.py

  # JSON-only (no SSE, final merged result)
  python meishi_ocr_kimi.py card.jpeg | python enrich_all.py --json
"""

import asyncio
import json
import os
import re
import sys
import time
from typing import Optional
from dotenv import load_dotenv
import httpx

load_dotenv()

CRUSTDATA_API_TOKEN = os.getenv("CRUSTDATA_API_TOKEN")
if not CRUSTDATA_API_TOKEN:
    print('{"error": "CRUSTDATA_API_TOKEN not found in .env"}', file=sys.stderr)
    sys.exit(1)

BASE = "https://api.crustdata.com"
HEADERS = {
    "Authorization": f"Token {CRUSTDATA_API_TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}
TIMEOUT = 15.0

FREEMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "yahoo.co.jp", "hotmail.com", "outlook.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com",
    "mail.com", "live.com", "msn.com", "ymail.com", "nifty.com",
    "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "i.softbank.jp",
}


# ======================= SSE OUTPUT =======================
def emit_sse(event: str, data: dict):
    """SSE 形式で stdout に push"""
    print(f"event: {event}", flush=True)
    print(f"data: {json.dumps(data, ensure_ascii=False)}", flush=True)
    print(flush=True)  # blank line = end of SSE message


# ======================= NAME UTILS =======================
def extract_romaji(name: str) -> Optional[str]:
    m = re.search(r"\(([A-Za-z\s\-\.]+)\)", name)
    return m.group(1).strip() if m else None


def get_search_names(name: str) -> list[str]:
    candidates = []
    romaji = extract_romaji(name)
    if romaji:
        candidates.append(romaji)
    ascii_only = re.sub(r"[^\x20-\x7E]", "", name).strip()
    if len(ascii_only) >= 3 and " " in ascii_only and ascii_only not in candidates:
        candidates.append(ascii_only)
    if name not in candidates:
        candidates.append(name)
    return candidates


def extract_domain(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    m = re.search(r"@([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})", email)
    if not m:
        return None
    domain = m.group(1).lower()
    return None if domain in FREEMAIL_DOMAINS else domain


# ======================= PERSON ENRICHMENT =======================
async def search_person(client: httpx.AsyncClient, name: str, company: Optional[str]) -> Optional[dict]:
    filters = [{"filter_type": "KEYWORD", "type": "in", "value": [name]}]
    if company:
        filters.append({"filter_type": "CURRENT_COMPANY", "type": "in", "value": [company]})

    resp = await client.post(
        f"{BASE}/screener/person/search",
        json={"filters": filters, "page": 1},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    profiles = resp.json().get("profiles", [])
    return profiles[0] if profiles else None


async def enrich_person_by_url(client: httpx.AsyncClient, url: str) -> Optional[dict]:
    resp = await client.get(
        f"{BASE}/screener/person/enrich",
        params={"linkedin_profile_url": url},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


async def enrich_person_by_email(client: httpx.AsyncClient, email: str) -> Optional[dict]:
    resp = await client.get(
        f"{BASE}/screener/person/enrich",
        params={"email": email},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


def parse_person(raw: dict) -> dict:
    experience = []
    for emp in raw.get("employer", []):
        experience.append({
            "title": emp.get("title"),
            "company_name": emp.get("company_name"),
            "start_date": emp.get("start_date"),
            "end_date": emp.get("end_date"),
            "location": emp.get("location"),
            "description": emp.get("description"),
        })
    education = []
    for edu in raw.get("education_background", []):
        education.append({
            "degree_name": edu.get("degree_name"),
            "institute_name": edu.get("institute_name"),
            "field_of_study": edu.get("field_of_study"),
            "start_date": edu.get("start_date"),
            "end_date": edu.get("end_date"),
        })
    return {
        "linkedin_url": raw.get("linkedin_profile_url"),
        "flagship_url": raw.get("flagship_profile_url"),
        "profile_picture_url": raw.get("profile_picture_url"),
        "headline": raw.get("headline"),
        "summary": raw.get("summary"),
        "location": raw.get("location"),
        "current_title": raw.get("current_title"),
        "current_company": raw.get("current_company"),
        "num_connections": raw.get("num_of_connections"),
        "skills": raw.get("skills", []),
        "experience": experience,
        "education": education,
    }


async def run_person_enrichment(client: httpx.AsyncClient, card: dict, use_sse: bool) -> dict:
    name = card.get("name")
    company = card.get("company")
    email = card.get("email")

    base = {
        "enriched": False,
        "namecard_name": name,
        "namecard_company": company,
        "namecard_title": card.get("title"),
        "namecard_email": email,
        "namecard_phone": card.get("phone"),
    }

    if not name:
        return base

    search_names = get_search_names(name)
    profile_raw = None

    for n in search_names:
        profile_raw = await search_person(client, n, company)
        if profile_raw:
            break
        if company:
            profile_raw = await search_person(client, n, None)
            if profile_raw:
                break

    enriched_raw = None
    if profile_raw is None and email:
        enriched_raw = await enrich_person_by_email(client, email)

    if profile_raw and not enriched_raw:
        url = profile_raw.get("linkedin_profile_url") or profile_raw.get("flagship_profile_url")
        if url:
            enriched_raw = await enrich_person_by_url(client, url)

    if profile_raw is None and enriched_raw is None:
        return base

    source = enriched_raw if enriched_raw else profile_raw
    return {**base, "enriched": True, **parse_person(source)}


# ======================= COMPANY ENRICHMENT =======================
async def enrich_company_by_domain(client: httpx.AsyncClient, domain: str) -> Optional[dict]:
    resp = await client.get(
        f"{BASE}/screener/company",
        params={"company_domain": domain},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


async def enrich_company_by_name(client: httpx.AsyncClient, name: str) -> Optional[dict]:
    resp = await client.get(
        f"{BASE}/screener/company",
        params={"company_name": name},
        headers=HEADERS,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None


def parse_company(raw: dict) -> dict:
    hq = raw.get("headquarters") or {}
    parts = [hq.get("city"), hq.get("geographicArea"), hq.get("country")]
    location = ", ".join(p for p in parts if p) or raw.get("location")

    rounds = raw.get("funding_rounds") or []
    last_round = last_date = None
    if rounds and isinstance(rounds, list):
        latest = rounds[-1]
        last_round = latest.get("round_name") or latest.get("funding_type")
        last_date = latest.get("announced_on") or latest.get("date")

    return {
        "company_id": raw.get("company_id"),
        "company_name": raw.get("company_name") or raw.get("name"),
        "company_domain": raw.get("company_website_domain") or raw.get("website"),
        "linkedin_url": raw.get("linkedin_profile_url") or raw.get("linkedin_company_url"),
        "description": raw.get("description"),
        "industry": raw.get("industry"),
        "founded_year": raw.get("founded_year"),
        "headcount": raw.get("headcount") or raw.get("employee_count"),
        "headcount_range": raw.get("employee_count_range"),
        "total_funding_usd": raw.get("total_funding_raised_usd") or raw.get("total_investment_usd"),
        "last_funding_round": last_round,
        "last_funding_date": last_date,
        "location": location,
        "company_type": raw.get("company_type"),
        "specialties": raw.get("specialties") or [],
    }


async def run_company_enrichment(client: httpx.AsyncClient, card: dict, use_sse: bool) -> dict:
    company_name = card.get("company")
    domain = extract_domain(card.get("email"))

    base = {
        "enriched": False,
        "query_company": company_name,
        "query_domain": domain,
    }

    raw = None
    if domain:
        raw = await enrich_company_by_domain(client, domain)
    if raw is None and company_name:
        raw = await enrich_company_by_name(client, company_name)

    if raw is None:
        return base

    return {**base, "enriched": True, **parse_company(raw)}


# ======================= ORCHESTRATOR =======================
async def orchestrate(card: dict, use_sse: bool):
    t0 = time.perf_counter()

    if use_sse:
        emit_sse("start", {"status": "enrichment_started", "namecard": card})

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        person_task = asyncio.create_task(run_person_enrichment(client, card, use_sse))
        company_task = asyncio.create_task(run_company_enrichment(client, card, use_sse))

        person_result = company_result = None

        # Wait for both, emit SSE as each completes
        done, pending = await asyncio.wait(
            {person_task, company_task},
            timeout=TIMEOUT,
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in done:
            if task is person_task:
                person_result = task.result()
                if use_sse:
                    emit_sse("person", person_result)
            elif task is company_task:
                company_result = task.result()
                if use_sse:
                    emit_sse("company", company_result)

        # Wait for remaining tasks
        if pending:
            done2, still_pending = await asyncio.wait(pending, timeout=max(0, TIMEOUT - (time.perf_counter() - t0)))
            for task in done2:
                if task is person_task:
                    person_result = task.result()
                    if use_sse:
                        emit_sse("person", person_result)
                elif task is company_task:
                    company_result = task.result()
                    if use_sse:
                        emit_sse("company", company_result)

            # Cancel anything still running after timeout
            for task in still_pending:
                task.cancel()
                label = "person" if task is person_task else "company"
                timeout_data = {"enriched": False, "error": "timeout"}
                if task is person_task:
                    person_result = timeout_data
                else:
                    company_result = timeout_data
                if use_sse:
                    emit_sse(label, timeout_data)

    elapsed = time.perf_counter() - t0

    merged = {
        "namecard": card,
        "person": person_result,
        "company": company_result,
        "meta": {
            "elapsed_sec": round(elapsed, 2),
            "person_enriched": bool(person_result and person_result.get("enriched")),
            "company_enriched": bool(company_result and company_result.get("enriched")),
        },
    }

    if use_sse:
        emit_sse("done", merged)
    else:
        print(json.dumps(merged, ensure_ascii=False, indent=2))


# ======================= CLI =======================
def main():
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print('{"error": "No input on stdin"}', file=sys.stderr)
        sys.exit(1)

    try:
        card = json.loads(raw_input)
    except json.JSONDecodeError as e:
        print(f'{{"error": "Invalid JSON: {e}"}}', file=sys.stderr)
        sys.exit(1)

    use_sse = "--json" not in sys.argv

    asyncio.run(orchestrate(card, use_sse))


if __name__ == "__main__":
    main()