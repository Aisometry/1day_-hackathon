"""
Aisometry Company Profile — 5次元定義 (JSON保存のみ)
=====================================================
① 5次元テキスト定義
② JSON保存 (embedding不要 — scoring は Kimi K2 が直接実行)

Usage:
  python aisometry_profile.py
  python aisometry_profile.py --output aisometry_profile.json
"""

import json
import sys
from pathlib import Path

AISOMETRY_PROFILE = {
    "industry_fit": {
        "label": "Industry Fit（業界適合性）",
        "description": (
            "Hospitality and hotel operations management including revenue management, "
            "dynamic pricing, demand forecasting for accommodation facilities. "
            "Manufacturing sector with quality inspection, anomaly detection, predictive maintenance. "
            "Construction and infrastructure with safety management AI and deterioration diagnosis. "
            "Real estate with contract document generation and back-office automation. "
            "Retail and logistics with demand forecasting, route optimization, and recommendation AI. "
            "Financial services with credit assessment, fraud detection, and insurance claim automation. "
            "Wildlife risk management platform FASTBEAR covering all 47 prefectures in Japan. "
            "Energy sector with AI-driven HVAC control systems. "
            "BPO and HR with resume matching and workforce allocation optimization."
        ),
    },
    "stage_match": {
        "label": "Stage Match（企業ステージ適合性）",
        "description": (
            "Mid-market to enterprise companies seeking AI transformation with 150万円/month consulting engagement. "
            "Companies with existing data assets like PMS, CRM, OTA data but lacking integration and AI utilization. "
            "Organizations at the Human+AI collaboration stage transitioning from manual expert-dependent workflows. "
            "Enterprises operating 25+ facilities or multi-site operations needing cross-location analytics. "
            "Companies with annual revenue of 100億円+ where 10-15% improvement translates to 15-22億円 impact. "
            "Clients ready for phased AI adoption: free PoC diagnosis in 2 weeks, pilot in 2 months, full rollout in 6 months. "
            "Organizations that have identified AI as strategic priority but need partner for implementation. "
            "Companies where business processes are still person-dependent and undocumented tacit knowledge exists."
        ),
    },
    "tech_alignment": {
        "label": "Tech Alignment（技術適合性）",
        "description": (
            "LLM and NLP including RAG, search agents, prompt injection defense, and on-premise LLM deployment. "
            "Computer vision with image recognition, object detection, OCR, video analysis, and edge AI deployment. "
            "Time-series deep learning for demand forecasting, anomaly detection, and numerical prediction. "
            "Reinforcement learning for dynamic pricing optimization and mathematical optimization. "
            "Multi-agent AI systems with autonomous data collection and self-directed agent swarm execution. "
            "MLOps with model monitoring, A/B testing, CI/CD, version management, and data quality management. "
            "Data infrastructure with data lake, ETL, feature stores, real-time and batch processing on Databricks and Snowflake. "
            "Cloud deployment on AWS, Azure, GCP with hybrid, on-premise, edge computing, and microservices architecture. "
            "Tool-use agents where LLM autonomously operates SaaS and software tools. "
            "Multimodal AI processing blueprints, graphs, videos, and unstructured data for semantic understanding."
        ),
    },
    "team_strength": {
        "label": "Team Strength（チーム力）",
        "description": (
            "CEO Hiroyuki Matsushima from University of Tokyo Matsuo Laboratory masters program researching large language models. "
            "CEO served as Chief AI Engineer at Matsuo Institute leading 3-year joint research with Nippon Television. "
            "CTO Animesh Harsh from UTokyo Matsuo Lab, trilingual in English Japanese Hindi, MEXT scholar, JLPT N1, "
            "experienced as AI engineer and PM across multiple companies. "
            "Chief Engineer Yoshihito Miyoshi from University of Tsukuba masters in information science, "
            "conducting joint research with Tokyo Institute of Science on adversarial attacks and reinforcement learning for LLMs. "
            "Sales lead Kenma Suzuki with 3+ years enterprise SaaS sales experience in core system contract negotiations. "
            "Technical advisor Takumi Yamashita, founding CTO of Staked/Astar Network, "
            "2-time world finalist in international programming contests, METI IPA Super Creator. "
            "Team holds G-certification, E-certification, serves as TA for UTokyo LLM courses. "
            "Startup agility with demo delivery in 3 days to 1 week from requirements."
        ),
    },
    "network_overlap": {
        "label": "Network Overlap（ネットワーク重複度）",
        "description": (
            "University of Tokyo Matsuo-Iwasawa Laboratory alumni network, Japan's premier AI research lab. "
            "Matsuo Institute corporate research network connecting academia and industry. "
            "Nippon Television joint research relationship spanning media and entertainment industry. "
            "FASTBEAR wildlife platform with 36 media outlets coverage including Yahoo News Japan, Fukushima Minpo, "
            "Niconico News, and Otakuma Keizai Shinbun, reaching 8000+ dashboard users in 3 months. "
            "Japanese hospitality industry connections through Withseed Hospitality Management engagement. "
            "METI IPA Super Creator network for blockchain and advanced technology community. "
            "International competitive programming community through world contest participation. "
            "India-Japan technology bridge through trilingual CTO with MEXT scholarship background. "
            "Tokyo Bunkyo-ku Hongo location near University of Tokyo campus and startup ecosystem."
        ),
    },
}


def main():
    output_path = "aisometry_profile.json"
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    Path(output_path).write_text(
        json.dumps(AISOMETRY_PROFILE, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Saved to {output_path}", file=sys.stderr)
    print(json.dumps(
        {k: v["label"] for k, v in AISOMETRY_PROFILE.items()},
        ensure_ascii=False, indent=2,
    ))


if __name__ == "__main__":
    main()