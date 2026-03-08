"""
E-3: ProfileBuilder & Merge
============================
S-301: merge(namecard, person, company) → CompanyProfile
S-302: CompanyProfile 型定義 + 正規化
S-303: ユニットテスト (--test)

Usage:
  # enrich_all.py --json の出力をパイプ
  python meishi_ocr_kimi.py card.jpeg | python enrich_all.py --json | python profile_builder.py

  # テスト実行
  python profile_builder.py --test
"""

import json
import re
import signal
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

# Handle broken pipe gracefully (piping to head, etc.)
signal.signal(signal.SIGPIPE, signal.SIG_DFL)


# ======================= S-302: CompanyProfile 型定義 =======================
@dataclass
class CompanyProfile:
    # --- Identity ---
    name: Optional[str] = None
    name_reading: Optional[str] = None       # ローマ字 or ふりがな
    company: Optional[str] = None
    company_normalized: Optional[str] = None  # 正規化後
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    # --- Person (CrustData) ---
    linkedin_url: Optional[str] = None
    headline: Optional[str] = None
    summary: Optional[str] = None
    person_location: Optional[str] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None
    skills: list[str] = field(default_factory=list)
    experience: list[dict] = field(default_factory=list)
    education: list[dict] = field(default_factory=list)
    profile_picture_url: Optional[str] = None

    # --- Company (CrustData) ---
    company_domain: Optional[str] = None
    company_linkedin_url: Optional[str] = None
    company_description: Optional[str] = None
    industry: Optional[str] = None
    founded_year: Optional[int] = None
    headcount: Optional[int] = None
    headcount_range: Optional[str] = None
    total_funding_usd: Optional[int] = None
    last_funding_round: Optional[str] = None
    company_location: Optional[str] = None
    company_type: Optional[str] = None
    specialties: list[str] = field(default_factory=list)

    # --- Meta ---
    sources: list[str] = field(default_factory=list)  # ["namecard", "person", "company"]
    merged_at: Optional[str] = None


# ======================= S-302: 正規化ロジック =======================
# 日本語/英語 会社名表記揺れ正規化
_COMPANY_SUFFIXES = [
    (r"株式会社\s*", ""),
    (r"\s*株式会社", ""),
    (r"㈱\s*", ""),
    (r"\s*㈱", ""),
    (r",?\s*Inc\.?$", ""),
    (r",?\s*Ltd\.?$", ""),
    (r",?\s*Co\.?,?\s*Ltd\.?$", ""),
    (r",?\s*Corp\.?$", ""),
    (r",?\s*Corporation$", ""),
    (r",?\s*K\.?K\.?$", ""),
    (r"\s+", " "),
]


def normalize_company_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    n = name.strip()
    for pattern, repl in _COMPANY_SUFFIXES:
        n = re.sub(pattern, repl, n, flags=re.IGNORECASE)
    return n.strip() or None


def normalize_date(date_str: Optional[str]) -> Optional[str]:
    """各種日付フォーマットを YYYY-MM-DD に統一"""
    if not date_str:
        return None
    # Already ISO
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", date_str)
    if m:
        return m.group(0)
    # ISO with time
    m = re.match(r"(\d{4}-\d{2}-\d{2})T", date_str)
    if m:
        return m.group(1)
    return date_str


def normalize_experience(exp_list: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for exp in exp_list:
        key = (
            exp.get("company_name", ""),
            exp.get("title", ""),
            exp.get("start_date", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "title": exp.get("title"),
            "company_name": exp.get("company_name"),
            "start_date": normalize_date(exp.get("start_date")),
            "end_date": normalize_date(exp.get("end_date")),
            "location": exp.get("location"),
            "description": exp.get("description"),
        })
    return out


def normalize_education(edu_list: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for edu in edu_list:
        key = (
            edu.get("institute_name", ""),
            edu.get("degree_name", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "degree_name": edu.get("degree_name"),
            "institute_name": edu.get("institute_name"),
            "field_of_study": edu.get("field_of_study"),
            "start_date": normalize_date(edu.get("start_date")),
            "end_date": normalize_date(edu.get("end_date")),
        })
    return out


def coalesce(*values):
    """最初の non-None / non-empty 値を返す"""
    for v in values:
        if v is not None and v != "" and v != []:
            return v
    return None


# ======================= S-301: merge() =======================
def merge(namecard: dict, person: dict, company: dict) -> CompanyProfile:
    """
    3データソースを統合。
    優先順位: 名刺 > CrustData Person > CrustData Company
    """
    sources = ["namecard"]
    if person and person.get("enriched"):
        sources.append("person")
    if company and company.get("enriched"):
        sources.append("company")

    # Extract romaji from namecard name
    nc_name = namecard.get("name")
    name_reading = None
    if nc_name:
        m = re.search(r"\(([A-Za-z\s\-\.]+)\)", nc_name)
        if m:
            name_reading = m.group(1).strip()

    # Company: 名刺 > person.current_company > company.company_name
    raw_company = coalesce(
        namecard.get("company"),
        person.get("current_company") if person else None,
        company.get("company_name") if company else None,
    )

    # Title: 名刺 > person.current_title
    title = coalesce(
        namecard.get("title"),
        person.get("current_title") if person else None,
    )

    profile = CompanyProfile(
        # Identity — 名刺優先
        name=nc_name,
        name_reading=name_reading,
        company=raw_company,
        company_normalized=normalize_company_name(raw_company),
        title=title,
        email=namecard.get("email"),
        phone=namecard.get("phone"),

        # Person — CrustData Person
        linkedin_url=person.get("linkedin_url") if person else None,
        headline=person.get("headline") if person else None,
        summary=person.get("summary") if person else None,
        person_location=person.get("location") if person else None,
        current_title=person.get("current_title") if person else None,
        current_company=person.get("current_company") if person else None,
        skills=person.get("skills", []) if person else [],
        experience=normalize_experience(person.get("experience", []) if person else []),
        education=normalize_education(person.get("education", []) if person else []),
        profile_picture_url=person.get("profile_picture_url") if person else None,

        # Company — CrustData Company
        company_domain=company.get("company_domain") if company else None,
        company_linkedin_url=company.get("linkedin_url") if company else None,
        company_description=company.get("description") if company else None,
        industry=company.get("industry") if company else None,
        founded_year=company.get("founded_year") if company else None,
        headcount=company.get("headcount") if company else None,
        headcount_range=company.get("headcount_range") if company else None,
        total_funding_usd=company.get("total_funding_usd") if company else None,
        last_funding_round=company.get("last_funding_round") if company else None,
        company_location=company.get("location") if company else None,
        company_type=company.get("company_type") if company else None,
        specialties=company.get("specialties", []) if company else [],

        # Meta
        sources=sources,
        merged_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

    return profile


# ======================= S-303: ユニットテスト =======================
def run_tests():
    passed = 0
    failed = 0

    def assert_eq(label, actual, expected):
        nonlocal passed, failed
        if actual == expected:
            passed += 1
            print(f"  ✅ {label}")
        else:
            failed += 1
            print(f"  ❌ {label}: expected={expected!r}, got={actual!r}")

    # --- Test 1: 正常系 (3ソース全あり) ---
    print("\nTest 1: Full merge (3 sources)")
    nc = {"name": "湯川昇平 (Shohei Yukawa)", "company": None, "title": "iOS エンジニア", "email": "test@gmail.com", "phone": "080-1234-5678"}
    ps = {"enriched": True, "current_title": "iOS Developer", "current_company": "Self-employed", "linkedin_url": "https://linkedin.com/in/test", "headline": "iOS Dev", "location": "Tokyo", "skills": ["Swift"], "experience": [{"title": "iOS Dev", "company_name": "Self", "start_date": "2025-01-01T00:00:00"}], "education": [{"institute_name": "Tama Art Univ", "degree_name": "BA"}]}
    co = {"enriched": True, "company_name": "Self-employed Inc.", "industry": "Technology", "headcount": 1, "founded_year": 2025}
    p = merge(nc, ps, co)
    assert_eq("sources", p.sources, ["namecard", "person", "company"])
    assert_eq("name", p.name, "湯川昇平 (Shohei Yukawa)")
    assert_eq("name_reading", p.name_reading, "Shohei Yukawa")
    assert_eq("title from namecard", p.title, "iOS エンジニア")
    assert_eq("linkedin", p.linkedin_url, "https://linkedin.com/in/test")
    assert_eq("industry", p.industry, "Technology")
    assert_eq("exp dedup", len(p.experience), 1)
    assert_eq("exp date normalized", p.experience[0]["start_date"], "2025-01-01")

    # --- Test 2: Person欠損 ---
    print("\nTest 2: Person missing")
    p2 = merge(nc, {"enriched": False}, co)
    assert_eq("sources", p2.sources, ["namecard", "company"])
    assert_eq("linkedin is None", p2.linkedin_url, None)
    assert_eq("industry still present", p2.industry, "Technology")

    # --- Test 3: Company欠損 ---
    print("\nTest 3: Company missing")
    p3 = merge(nc, ps, {"enriched": False})
    assert_eq("sources", p3.sources, ["namecard", "person"])
    assert_eq("industry is None", p3.industry, None)
    assert_eq("linkedin present", p3.linkedin_url, "https://linkedin.com/in/test")

    # --- Test 4: 会社名正規化 ---
    print("\nTest 4: Company name normalization")
    assert_eq("株式会社 prefix", normalize_company_name("株式会社テスト"), "テスト")
    assert_eq("suffix 株式会社", normalize_company_name("テスト株式会社"), "テスト")
    assert_eq("Inc.", normalize_company_name("Test Corp, Inc."), "Test Corp")
    assert_eq("Co., Ltd.", normalize_company_name("Test Co., Ltd."), "Test")
    assert_eq("None input", normalize_company_name(None), None)

    # --- Test 5: 矛盾データ優先順位 ---
    print("\nTest 5: Conflicting data priority")
    nc5 = {"name": "Test", "company": "CardCompany", "title": "名刺タイトル", "email": None, "phone": None}
    ps5 = {"enriched": True, "current_title": "LinkedIn Title", "current_company": "LinkedInCo", "experience": [], "education": [], "skills": []}
    co5 = {"enriched": True, "company_name": "CrustCompany"}
    p5 = merge(nc5, ps5, co5)
    assert_eq("company from namecard", p5.company, "CardCompany")
    assert_eq("title from namecard", p5.title, "名刺タイトル")

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    return failed == 0


# ======================= CLI =======================
def main():
    if "--test" in sys.argv:
        success = run_tests()
        sys.exit(0 if success else 1)

    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print('{"error": "No input on stdin"}', file=sys.stderr)
        sys.exit(1)

    data = json.loads(raw_input)

    # enrich_all.py --json の出力形式: {"namecard": {...}, "person": {...}, "company": {...}}
    namecard = data.get("namecard", {})
    person = data.get("person", {})
    company = data.get("company", {})

    profile = merge(namecard, person, company)
    print(json.dumps(asdict(profile), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
