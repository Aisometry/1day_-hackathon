"""
名刺 → CrustData Company Enrichment
======================================
① stdin から名刺OCR JSON を受け取る
② company名 or email domain で /screener/company 呼出
③ CompanyData 型の JSON を stdout に出力
④ 404 / 未取得時は enriched=false フラグ付き

Usage:
  python meishi_ocr_kimi.py card.jpeg | python enrich_company.py
  echo '{"name":"田中太郎","company":"Google","email":"tanaka@google.com"}' | python enrich_company.py
"""

import json
import os
import re
import sys
import httpx
from dataclasses import dataclass, field, asdict
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

CRUSTDATA_API_TOKEN = os.getenv("CRUSTDATA_API_TOKEN")
if not CRUSTDATA_API_TOKEN:
    print('{"error": "CRUSTDATA_API_TOKEN not found in .env"}', file=sys.stderr)
    sys.exit(1)

BASE = "https://api.crustdata.com"
HEADERS = {
    "Authorization": f"Token {CRUSTDATA_API_TOKEN}",
    "Accept": "application/json",
}
TIMEOUT = 30.0

# gmail, yahoo, etc. → 会社ドメインではない
FREEMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "yahoo.co.jp", "hotmail.com", "outlook.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com",
    "mail.com", "live.com", "msn.com", "ymail.com", "nifty.com",
    "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "i.softbank.jp",
}


# ======================= DATA MODEL =======================
@dataclass
class CompanyData:
    enriched: bool = False
    query_company: Optional[str] = None
    query_domain: Optional[str] = None
    # CrustData fields
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    linkedin_url: Optional[str] = None
    description: Optional[str] = None
    industry: Optional[str] = None
    founded_year: Optional[int] = None
    headcount: Optional[int] = None
    headcount_range: Optional[str] = None
    total_funding_usd: Optional[int] = None
    last_funding_round: Optional[str] = None
    last_funding_date: Optional[str] = None
    location: Optional[str] = None
    company_type: Optional[str] = None
    specialties: list[str] = field(default_factory=list)


# ======================= UTILS =======================
def extract_domain(email: Optional[str]) -> Optional[str]:
    """メールアドレスからドメインを抽出。フリーメールは除外。"""
    if not email:
        return None
    m = re.search(r"@([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})", email)
    if not m:
        return None
    domain = m.group(1).lower()
    if domain in FREEMAIL_DOMAINS:
        return None
    return domain


# ======================= API CALLS =======================
def enrich_by_domain(domain: str) -> Optional[dict]:
    """GET /screener/company?company_domain=..."""
    with httpx.Client(timeout=TIMEOUT) as client:
        resp = client.get(
            f"{BASE}/screener/company",
            params={"company_domain": domain},
            headers=HEADERS,
        )

    if resp.status_code in (404, 400):
        return None
    if resp.status_code != 200:
        print(f"Company enrich(domain) {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        return None

    data = resp.json()
    if isinstance(data, list):
        return data[0] if data else None
    return data


def enrich_by_name(name: str) -> Optional[dict]:
    """GET /screener/company?company_name=..."""
    with httpx.Client(timeout=TIMEOUT) as client:
        resp = client.get(
            f"{BASE}/screener/company",
            params={"company_name": name},
            headers=HEADERS,
        )

    if resp.status_code in (404, 400):
        return None
    if resp.status_code != 200:
        print(f"Company enrich(name) {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        return None

    data = resp.json()
    if isinstance(data, list):
        return data[0] if data else None
    return data


# ======================= PARSING =======================
def parse_company(raw: dict) -> dict:
    """CrustData レスポンスを CompanyData 用 dict にパース"""
    # Location
    hq = raw.get("headquarters")
    if isinstance(hq, dict):
        location_parts = [hq.get("city"), hq.get("geographicArea"), hq.get("country")]
        location = ", ".join(p for p in location_parts if p) or raw.get("location")
    elif isinstance(hq, str):
        location = hq
    else:
        location = raw.get("location")

    # Funding
    funding_rounds = raw.get("funding_rounds") or []
    last_round = None
    last_funding_date = None
    if funding_rounds:
        latest = funding_rounds[-1] if isinstance(funding_rounds, list) else None
        if latest:
            last_round = latest.get("round_name") or latest.get("funding_type")
            last_funding_date = latest.get("announced_on") or latest.get("date")

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
        "last_funding_date": last_funding_date,
        "location": location,
        "company_type": raw.get("company_type"),
        "specialties": raw.get("specialties") or [],
    }


# ======================= MAIN =======================
def main():
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print('{"error": "No input received on stdin"}', file=sys.stderr)
        sys.exit(1)

    try:
        card = json.loads(raw_input)
    except json.JSONDecodeError as e:
        print(f'{{"error": "Invalid JSON: {e}"}}', file=sys.stderr)
        sys.exit(1)

    company_name = card.get("company")
    email = card.get("email")
    domain = extract_domain(email)

    print(f"Company enrichment: name={company_name}, domain={domain}", file=sys.stderr)

    raw = None

    # 1) ドメインで検索 (最も正確)
    if domain:
        print(f"  Trying domain: {domain}", file=sys.stderr)
        raw = enrich_by_domain(domain)

    # 2) 会社名で検索
    if raw is None and company_name:
        print(f"  Trying company name: {company_name}", file=sys.stderr)
        raw = enrich_by_name(company_name)

    if raw is None:
        result = CompanyData(
            enriched=False,
            query_company=company_name,
            query_domain=domain,
        )
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
        return

    parsed = parse_company(raw)
    result = CompanyData(
        enriched=True,
        query_company=company_name,
        query_domain=domain,
        **parsed,
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()