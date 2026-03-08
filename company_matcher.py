"""
E-4: CompanyMatcher — Kimi K2 LLM Scorer
==========================================
S-402: CompanyProfile → 5次元テキスト生成 → Kimi K2 が直接 0-1 スコアリング
S-403: Ranked JSON + 推奨アクション生成

Usage:
  python meishi_ocr_kimi.py card.jpeg | python enrich_all.py --json | python profile_builder.py | python company_matcher.py
"""

import json
import os
import re
import sys
import time
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

UNBOUND_API_KEY = os.getenv("UNBOUND_API_KEY")
if not UNBOUND_API_KEY:
    print('{"error": "UNBOUND_API_KEY not found"}', file=sys.stderr)
    sys.exit(1)

BASE_URL = os.getenv("UNBOUND_BASE_URL", "https://api.getunbound.ai/v1")
SCORER_MODEL = os.getenv("SCORER_MODEL", "fireworks-ai/kimi-k2-instruct-0905")
REFERENCE_PATH = os.getenv("AISOMETRY_PROFILE", "aisometry_profile.json")
TARGET_RESPONSE_SEC = 3.0

WEIGHTS = {
    "industry_fit": 0.30,
    "stage_match": 0.25,
    "tech_alignment": 0.20,
    "team_strength": 0.15,
    "network_overlap": 0.10,
}

DIMENSION_LABELS = {
    "industry_fit": "Industry Fit（業界適合性）",
    "stage_match": "Stage Match（ステージ適合性）",
    "tech_alignment": "Tech Alignment（技術適合性）",
    "team_strength": "Team Strength（チーム力）",
    "network_overlap": "Network Overlap（ネットワーク）",
}


# ======================= 5次元テキスト生成 =======================
def build_dimension_texts(profile: dict) -> dict[str, str]:
    company = profile.get("company") or profile.get("company_normalized") or ""
    industry = profile.get("industry") or ""
    description = profile.get("company_description") or ""
    specialties = ", ".join(profile.get("specialties", []))
    title = profile.get("title") or profile.get("current_title") or ""
    headline = profile.get("headline") or ""
    headcount = profile.get("headcount") or ""
    funding = profile.get("total_funding_usd") or ""
    founded = profile.get("founded_year") or ""
    location = profile.get("company_location") or profile.get("person_location") or ""
    skills = ", ".join(profile.get("skills", []))

    exp_summary = ""
    for exp in profile.get("experience", [])[:3]:
        c = exp.get("company_name", "")
        t = exp.get("title", "")
        if c or t:
            exp_summary += f"{t} at {c}. "

    edu_summary = ""
    for edu in profile.get("education", [])[:2]:
        inst = edu.get("institute_name", "")
        deg = edu.get("degree_name", "")
        fos = edu.get("field_of_study", "")
        if inst:
            edu_summary += f"{deg} {fos} from {inst}. "

    return {
        "industry_fit": (
            f"Company: {company}. Industry: {industry}. {description} "
            f"Specialties: {specialties}. Person role: {title}. {headline}"
        ).strip(),
        "stage_match": (
            f"Company: {company}. Headcount: {headcount}. Founded: {founded}. "
            f"Total funding: {funding} USD. Type: {profile.get('company_type', '')}. "
            f"Location: {location}. Stage: {headline}"
        ).strip(),
        "tech_alignment": (
            f"Title: {title}. Skills: {skills}. "
            f"Experience: {exp_summary}Education: {edu_summary}"
            f"Specialties: {specialties}. Industry: {industry}."
        ).strip(),
        "team_strength": (
            f"Person: {profile.get('name', '')}. Title: {title}. "
            f"Headline: {headline}. Experience: {exp_summary}"
            f"Education: {edu_summary}Skills: {skills}."
        ).strip(),
        "network_overlap": (
            f"Company: {company}. Location: {location}. Industry: {industry}. "
            f"LinkedIn: {profile.get('linkedin_url', '')}. "
            f"Companies: {', '.join(e.get('company_name', '') for e in profile.get('experience', [])[:5])}. "
            f"Schools: {', '.join(e.get('institute_name', '') for e in profile.get('education', [])[:3])}."
        ).strip(),
    }


# ======================= Kimi K2 Scoring =======================
SCORING_PROMPT = """\
You are a B2B lead scoring engine. Score how well a LEAD matches a REFERENCE company profile.

REFERENCE COMPANY (Aisometry — AI consulting startup from UTokyo Matsuo Lab):
{reference_text}

LEAD PROFILE:
{lead_text}

DIMENSION: {dimension_label}

Score the match from 0.0 to 1.0:
- 1.0 = perfect match, ideal client/partner
- 0.7 = strong overlap, high potential
- 0.4 = moderate relevance, some alignment
- 0.2 = weak connection
- 0.0 = no relevance at all

Respond with ONLY a JSON object, no markdown, no explanation:
{{"score": <float>, "reason": "<1 sentence in Japanese>"}}
"""


def score_with_kimi(reference: dict, dim_texts: dict) -> tuple[dict, float]:
    """Call Kimi K2 once with all 5 dimensions batched in a single prompt."""
    t0 = time.perf_counter()

    # Build batch prompt for efficiency
    batch_prompt = (
        "You are a B2B lead scoring engine for Aisometry, an AI consulting startup from UTokyo Matsuo Lab.\n"
        "Score how well a LEAD matches Aisometry across 5 dimensions.\n\n"
        "Score each dimension from 0.0 to 1.0:\n"
        "- 1.0 = perfect match, ideal client/partner\n"
        "- 0.7 = strong overlap\n"
        "- 0.4 = moderate relevance\n"
        "- 0.2 = weak connection\n"
        "- 0.0 = no relevance\n\n"
    )

    for key in WEIGHTS:
        ref_desc = reference.get(key, {}).get("description", "")
        lead_text = dim_texts.get(key, "")
        label = DIMENSION_LABELS[key]
        batch_prompt += (
            f"--- {label} ---\n"
            f"REFERENCE: {ref_desc[:300]}\n"
            f"LEAD: {lead_text[:300]}\n\n"
        )

    batch_prompt += (
        "Respond with ONLY a valid JSON object, no markdown, no thinking:\n"
        '{"industry_fit": {"score": <float>, "reason": "<1 sentence JP>"},'
        ' "stage_match": {"score": <float>, "reason": "<1 sentence JP>"},'
        ' "tech_alignment": {"score": <float>, "reason": "<1 sentence JP>"},'
        ' "team_strength": {"score": <float>, "reason": "<1 sentence JP>"},'
        ' "network_overlap": {"score": <float>, "reason": "<1 sentence JP>"}}'
    )

    payload = {
        "model": SCORER_MODEL,
        "max_tokens": 1024,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": batch_prompt}],
    }

    headers = {
        "Authorization": f"Bearer {UNBOUND_API_KEY}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(f"{BASE_URL}/chat/completions", json=payload, headers=headers)

    elapsed = time.perf_counter() - t0

    if resp.status_code != 200:
        print(f"Scorer API error {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        return {k: {"score": 0.0, "reason": "API error"} for k in WEIGHTS}, elapsed

    raw_text = resp.json()["choices"][0]["message"]["content"].strip()

    # Extract JSON (Kimi may include thinking)
    scores = _extract_json(raw_text)
    if scores is None:
        print(f"Failed to parse scores. Raw:\n{raw_text[:500]}", file=sys.stderr)
        return {k: {"score": 0.0, "reason": "parse error"} for k in WEIGHTS}, elapsed

    # Normalize scores to 0-1 range
    for key in WEIGHTS:
        if key in scores:
            s = scores[key]
            if isinstance(s, dict):
                s["score"] = max(0.0, min(1.0, float(s.get("score", 0))))
            else:
                scores[key] = {"score": max(0.0, min(1.0, float(s))), "reason": ""}
        else:
            scores[key] = {"score": 0.0, "reason": "未評価"}

    return scores, elapsed


def _extract_json(text: str) -> dict | None:
    # Try fenced blocks
    fenced = re.findall(r"```(?:json)?\s*\n?(\{.*?\})\s*\n?```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced[-1])
        except json.JSONDecodeError:
            pass

    # Try last JSON object
    for m in reversed(list(re.finditer(r"\{", text))):
        candidate = text[m.start():]
        depth, end = 0, None
        for i, ch in enumerate(candidate):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            if depth == 0:
                end = i + 1
                break
        if end:
            try:
                return json.loads(candidate[:end])
            except json.JSONDecodeError:
                continue
    return None


# ======================= Result Builder =======================
TIER_THRESHOLDS = {"S": 0.70, "A": 0.55, "B": 0.40, "C": 0.25}

ACTION_TEMPLATES = {
    "S": "即アプローチ推奨。パーソナライズ提案書を作成し、1週間以内にコンタクト。",
    "A": "優先リードとしてフォローアップ。共通点を軸にした初回ミーティング提案。",
    "B": "ナーチャリング対象。業界事例やホワイトペーパーを送付し関係構築。",
    "C": "低優先。定期的な情報提供リストに追加し、シグナル変化を監視。",
    "D": "現時点ではフィット低。CRMに記録し、将来の変化に備える。",
}


def get_tier(overall: float) -> str:
    for tier, threshold in TIER_THRESHOLDS.items():
        if overall >= threshold:
            return tier
    return "D"


def build_result(profile: dict, scores: dict, dim_texts: dict, elapsed: float) -> dict:
    # Compute weighted overall
    numeric = {}
    for k in WEIGHTS:
        numeric[k] = scores[k]["score"] if isinstance(scores[k], dict) else float(scores[k])

    overall = round(sum(numeric[k] * WEIGHTS[k] for k in WEIGHTS), 4)
    tier = get_tier(overall)

    dimensions = []
    for key in WEIGHTS:
        entry = scores[key]
        sc = entry["score"] if isinstance(entry, dict) else float(entry)
        reason = entry.get("reason", "") if isinstance(entry, dict) else ""
        dimensions.append({
            "key": key,
            "label": DIMENSION_LABELS[key],
            "score": round(sc, 4),
            "weight": WEIGHTS[key],
            "weighted_score": round(sc * WEIGHTS[key], 4),
            "reason": reason,
            "input_text": dim_texts.get(key, ""),
        })

    dimensions.sort(key=lambda d: d["score"], reverse=True)

    top = dimensions[0]
    low = dimensions[-1]

    action = (
        f"{ACTION_TEMPLATES[tier]} "
        f"強み: {top['label']} ({top['score']:.0%})。"
        f"改善余地: {low['label']} ({low['score']:.0%})。"
    )

    return {
        "overall_score": overall,
        "tier": tier,
        "action": action,
        "dimensions": dimensions,
        "profile_summary": {
            "name": profile.get("name"),
            "company": profile.get("company") or profile.get("current_company"),
            "title": profile.get("title") or profile.get("current_title"),
            "industry": profile.get("industry"),
            "location": profile.get("company_location") or profile.get("person_location"),
        },
        "meta": {
            "scorer_model": SCORER_MODEL,
            "elapsed_sec": round(elapsed, 2),
            "within_target": elapsed <= TARGET_RESPONSE_SEC,
            "weights": WEIGHTS,
        },
    }


# ======================= CLI =======================
def main():
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print('{"error": "No input on stdin"}', file=sys.stderr)
        sys.exit(1)

    profile = json.loads(raw_input)

    # Load reference profile
    ref_path = Path(REFERENCE_PATH)
    if not ref_path.exists():
        print(f"Reference not found: {REFERENCE_PATH}. Run: python aisometry_profile.py", file=sys.stderr)
        sys.exit(1)
    reference = json.loads(ref_path.read_text(encoding="utf-8"))

    dim_texts = build_dimension_texts(profile)

    print(f"Scoring with {SCORER_MODEL}...", file=sys.stderr)
    scores, elapsed = score_with_kimi(reference, dim_texts)

    result = build_result(profile, scores, dim_texts, elapsed)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()