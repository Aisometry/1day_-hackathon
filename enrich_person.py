"""
名刺 → CrustData Person Enrichment
====================================
① stdin から名刺OCR JSON を受け取る (name, company)
② CrustData /screener/person/search で人物検索
③ ヒットした場合 /screener/person/enrich で詳細取得
④ PersonProfile 型の JSON を stdout に出力
⑤ 404 / 未取得時は enriched=false フラグ付き

Usage:
  python meishi_ocr_kimi.py card.jpeg | python enrich_person.py
  echo '{"name":"田中太郎","company":"Google"}' | python enrich_person.py
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
    "Content-Type": "application/json",
    "Accept": "application/json",
}
TIMEOUT = 30.0


# ======================= DATA MODELS =======================
@dataclass
class Employment:
    title: Optional[str] = None
    company_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None


@dataclass
class Education:
    degree_name: Optional[str] = None
    institute_name: Optional[str] = None
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


@dataclass
class PersonProfile:
    enriched: bool = False
    # 名刺元データ
    namecard_name: Optional[str] = None
    namecard_company: Optional[str] = None
    namecard_title: Optional[str] = None
    namecard_email: Optional[str] = None
    namecard_phone: Optional[str] = None
    # CrustData enriched fields
    linkedin_url: Optional[str] = None
    flagship_url: Optional[str] = None
    profile_picture_url: Optional[str] = None
    headline: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None
    num_connections: Optional[int] = None
    skills: list[str] = field(default_factory=list)
    experience: list[dict] = field(default_factory=list)
    education: list[dict] = field(default_factory=list)


# ======================= NAME UTILS =======================
def extract_romaji(name: str) -> Optional[str]:
    """'湯川昇平 (Shohei Yukawa)' → 'Shohei Yukawa'"""
    m = re.search(r"\(([A-Za-z\s\-\.]+)\)", name)
    if m:
        return m.group(1).strip()
    return None


def extract_ascii_name(name: str) -> Optional[str]:
    """If the name is already all-ASCII, return as-is."""
    ascii_only = re.sub(r"[^\x20-\x7E]", "", name).strip()
    if len(ascii_only) >= 3 and " " in ascii_only:
        return ascii_only
    return None


def get_search_names(name: str) -> list[str]:
    """Return a list of name variants to try, romaji first."""
    candidates = []
    romaji = extract_romaji(name)
    if romaji:
        candidates.append(romaji)
    ascii_name = extract_ascii_name(name)
    if ascii_name and ascii_name not in candidates:
        candidates.append(ascii_name)
    # Also try the raw name (might work for English-only cards)
    if name not in candidates:
        candidates.append(name)
    return candidates


# ======================= API CALLS =======================
def search_person(name: str, company: Optional[str]) -> Optional[dict]:
    """
    CrustData People Search: KEYWORD(name) + CURRENT_COMPANY でプロフィール検索
    最初のマッチを返す。見つからなければ None。
    """
    filters = [
        {"filter_type": "KEYWORD", "type": "in", "value": [name]},
    ]
    if company:
        filters.append(
            {"filter_type": "CURRENT_COMPANY", "type": "in", "value": [company]}
        )

    payload = {"filters": filters, "page": 1}

    with httpx.Client(timeout=TIMEOUT) as client:
        resp = client.post(
            f"{BASE}/screener/person/search",
            json=payload,
            headers=HEADERS,
        )

    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        print(
            f"Search API error {resp.status_code}: {resp.text[:300]}",
            file=sys.stderr,
        )
        return None

    data = resp.json()
    profiles = data.get("profiles", [])
    return profiles[0] if profiles else None


def enrich_by_email(email: str) -> Optional[dict]:
    """
    CrustData People Enrichment: メールアドレスから詳細プロフィール取得
    """
    with httpx.Client(timeout=TIMEOUT) as client:
        resp = client.get(
            f"{BASE}/screener/person/enrich",
            params={"email": email},
            headers=HEADERS,
        )

    if resp.status_code in (404, 400):
        return None
    if resp.status_code != 200:
        print(
            f"Enrich(email) API error {resp.status_code}: {resp.text[:300]}",
            file=sys.stderr,
        )
        return None

    data = resp.json()
    if isinstance(data, list):
        return data[0] if data else None
    return data


def enrich_person(linkedin_url: str) -> Optional[dict]:
    """
    CrustData People Enrichment: LinkedIn URL から詳細プロフィール取得
    """
    with httpx.Client(timeout=TIMEOUT) as client:
        resp = client.get(
            f"{BASE}/screener/person/enrich",
            params={"linkedin_profile_url": linkedin_url},
            headers=HEADERS,
        )

    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        print(
            f"Enrich API error {resp.status_code}: {resp.text[:300]}",
            file=sys.stderr,
        )
        return None

    data = resp.json()
    # Response can be a list or single object
    if isinstance(data, list):
        return data[0] if data else None
    return data


# ======================= PARSING =======================
def parse_profile(raw: dict) -> dict:
    """CrustData のレスポンスを PersonProfile 用の dict にパース"""
    experience = []
    for emp in raw.get("employer", []):
        experience.append(asdict(Employment(
            title=emp.get("title"),
            company_name=emp.get("company_name"),
            start_date=emp.get("start_date"),
            end_date=emp.get("end_date"),
            location=emp.get("location"),
            description=emp.get("description"),
        )))

    education = []
    for edu in raw.get("education_background", []):
        education.append(asdict(Education(
            degree_name=edu.get("degree_name"),
            institute_name=edu.get("institute_name"),
            field_of_study=edu.get("field_of_study"),
            start_date=edu.get("start_date"),
            end_date=edu.get("end_date"),
        )))

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


# ======================= MAIN =======================
def main():
    # stdin から名刺JSON読み取り
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print('{"error": "No input received on stdin"}', file=sys.stderr)
        sys.exit(1)

    try:
        card = json.loads(raw_input)
    except json.JSONDecodeError as e:
        print(f'{{"error": "Invalid JSON input: {e}"}}', file=sys.stderr)
        sys.exit(1)

    name = card.get("name")
    company = card.get("company")

    if not name:
        result = PersonProfile(
            enriched=False,
            namecard_name=name,
            namecard_company=company,
            namecard_title=card.get("title"),
            namecard_email=card.get("email"),
            namecard_phone=card.get("phone"),
        )
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
        return

    email = card.get("email")
    search_names = get_search_names(name)

    print(f"Search candidates: {search_names}, company={company}, email={email}", file=sys.stderr)

    # Step 1: Try search with each name variant
    profile_raw = None
    for candidate_name in search_names:
        print(f"  Trying: name='{candidate_name}' + company='{company}'", file=sys.stderr)
        profile_raw = search_person(candidate_name, company)
        if profile_raw:
            break
        # Retry without company
        if company:
            print(f"  Trying: name='{candidate_name}' (no company)", file=sys.stderr)
            profile_raw = search_person(candidate_name, None)
            if profile_raw:
                break

    # Step 2: Fallback — enrich by email
    enriched_raw = None
    if profile_raw is None and email:
        print(f"  Fallback: enriching by email={email}", file=sys.stderr)
        enriched_raw = enrich_by_email(email)

    if profile_raw is None and enriched_raw is None:
        # 未取得
        result = PersonProfile(
            enriched=False,
            namecard_name=name,
            namecard_company=company,
            namecard_title=card.get("title"),
            namecard_email=card.get("email"),
            namecard_phone=card.get("phone"),
        )
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
        return

    # Step 3: If we found via search, try deeper enrichment via LinkedIn URL
    if profile_raw and not enriched_raw:
        linkedin_url = profile_raw.get("linkedin_profile_url") or profile_raw.get("flagship_profile_url")
        if linkedin_url:
            print(f"Enriching: {linkedin_url}", file=sys.stderr)
            enriched_raw = enrich_person(linkedin_url)

    # Use enriched data if available, otherwise fall back to search data
    source = enriched_raw if enriched_raw else profile_raw
    parsed = parse_profile(source)

    result = PersonProfile(
        enriched=True,
        namecard_name=name,
        namecard_company=company,
        namecard_title=card.get("title"),
        namecard_email=card.get("email"),
        namecard_phone=card.get("phone"),
        **parsed,
    )

    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()