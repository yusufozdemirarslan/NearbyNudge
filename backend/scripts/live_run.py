"""Live end-to-end run: real Claude API, real Overture listings, real business websites.

Runs one small campaign in a throwaway app database (the real listings file is reused) and
prints what a user would see plus timing and cost. Costs real money (roughly $0.10-0.25 a lead).

    cd backend && .venv/Scripts/python.exe scripts/live_run.py --leads 5
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from nearbynudge.app import create_app  # noqa: E402
from nearbynudge.config import ROOT, Settings  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--leads", type=int, default=5)
    p.add_argument("--location", default="Arlington, VA")
    p.add_argument("--industry", default="Dentists")
    p.add_argument("--radius", type=float, default=5)
    p.add_argument("--offer", default="Google Ads campaigns for dental practices")
    p.add_argument("--proof", default="Grew new-patient bookings 30% for a Fairfax practice in 3 months")
    p.add_argument("--cta", default="A free 15-minute ads audit")
    p.add_argument("--report", default=str(ROOT / "docs" / "live-run-report.json"))
    args = p.parse_args()

    real_data = ROOT / "data"
    tmp = Path(tempfile.mkdtemp(prefix="nn-live-"))
    shutil.copytree(real_data / "gazetteer", tmp / "gazetteer")
    settings = Settings(NN_DATA_DIR=tmp, NN_LISTINGS_PATH=real_data / "listings.duckdb", NN_ENV="dev",
                        NN_WORKER_CONCURRENCY=4)
    if not settings.ai_configured:
        sys.exit("ANTHROPIC_API_KEY isn't set in .env")
    app = create_app(settings)
    t0 = time.monotonic()
    with TestClient(app, base_url="http://localhost:8000") as c:
        c.get("/api/me")
        h = {"X-CSRF-Token": c.cookies.get("nn_csrf")}
        c.put("/api/account/profile", json={"sender_name": "Maya Chen", "sender_company": "Brightline Ads",
                                            "sender_address": "123 Example St, Arlington, VA 22201"}, headers=h).raise_for_status()
        inp = {"location": args.location, "radius_mi": args.radius, "industry": args.industry, "offer_what": args.offer,
               "offer_proof": args.proof, "offer_cta": args.cta, "tone": "professional", "lead_target": args.leads}
        t = time.monotonic()
        r = c.post("/api/campaigns/plan", json=inp, headers=h)
        r.raise_for_status()
        plan = r.json()
        plan_s = time.monotonic() - t
        print(f"\nPLAN ({plan_s:.1f}s): {plan['restatement']}")
        print("  categories:", [f"{x['label']} ({x['count']})" for x in plan["categories"]])
        print("  question:", plan["question"]["text"] if plan["question"] else None, "| candidates:", plan["candidate_count"],
              "| warnings:", plan["warnings"])
        r = c.post("/api/campaigns", json={"plan_id": plan["plan_id"], "input": inp, "answer": "no" if plan["question"] else None}, headers=h)
        r.raise_for_status()
        cid = r.json()["id"]
        started = time.monotonic()
        first_card = first_ready = None
        while True:
            camp = c.get(f"/api/campaigns/{cid}").json()
            leads = c.get(f"/api/campaigns/{cid}/leads").json()
            now = time.monotonic() - started
            if leads and first_card is None:
                first_card = now
            if first_ready is None and any(ld["status"] in ("ready", "needs_review") for ld in leads):
                first_ready = now
            states = {}
            for ld in leads:
                states[ld["status"]] = states.get(ld["status"], 0) + 1
            print(f"  t={now:5.0f}s status={camp['status']:<11} {states} {camp.get('status_detail') or ''}", flush=True)
            if camp["status"] in ("done", "failed"):
                break
            if now > 1200:
                print("  giving up after 20 minutes")
                break
            time.sleep(10)
        total_s = time.monotonic() - started
        print(f"\nFirst cards after {first_card or 0:.0f}s; first finished lead after {first_ready or 0:.0f}s; all done after {total_s:.0f}s")
        print("Notices:", camp["notices"])
        report = {"plan": plan, "campaign": camp, "timing": {"plan_s": plan_s, "first_card_s": first_card,
                                                             "first_ready_s": first_ready, "total_s": total_s}, "leads": []}
        for ld in leads:
            full = c.get(f"/api/leads/{ld['id']}").json()
            report["leads"].append(full)
            email = full.get("email") or {}
            facts = full.get("facts", [])
            research = [f for f in facts if f["source_kind"] == "site" and f["quote"]]
            print(f"\n== {full['name']} [{full['status']}] fit={full['fit_score']} ({full['fit_label']}) {full['distance_mi']} mi  cost=${full['cost_usd']:.3f}")
            print(f"   site: {full['website']} | contact: {(full.get('contact') or {}).get('kind')} via {(full.get('contact') or {}).get('source_label')}")
            if full.get("error"):
                print("   error:", full["error"])
            print(f"   facts: {len(facts)} ({len(research)} quoted from the site, {sum(1 for f in research if f['quote_found'])} quotes found in the page)")
            for f in research[:4]:
                print(f"     - {f['text']}  [{f['source_label']}; quote found: {f['quote_found']}; state: {f['state']}]")
            if full.get("hook"):
                print(f"   hook: {full['hook']['title']} - {full['hook']['reason']}")
            if email:
                print(f"   subject: {email['subject']}  ({email['word_count']} words)")
                for para in email["paragraphs"]:
                    print("     " + " ".join(f"{s['text']} <{s['state']}>" for s in para))
            if full.get("editor"):
                ed = full["editor"]
                print(f"   editor: {ed['passed']}/{ed['total']} passed; fixes: {ed['fixes']}; notes: {ed['notes']}")
            if full.get("warnings"):
                print("   warnings:", full["warnings"])
        ready = [ld for ld in leads if ld["status"] in ("ready", "needs_review")]
        if ready:
            t = time.monotonic()
            r = c.post(f"/api/leads/{ready[0]['id']}/rewrite", json={"mode": "shorter"}, headers=h)
            rewrite_s = time.monotonic() - t
            report["timing"]["rewrite_s"] = rewrite_s
            out = r.json()
            print(f"\nREWRITE shorter: {r.status_code} in {rewrite_s:.1f}s -> {out.get('email', {}).get('word_count')} words, status {out.get('status')}")
        ov = c.get("/api/admin/overview").json()
        report["spend"] = ov["spend"]
        report["quality"] = ov["quality"]
        print(f"\nSPEND: total ${ov['spend']['today']:.3f} | per lead ${ov['quality']['avg_cost_per_lead']} | by skill:")
        for s in ov["spend"]["by_skill"]:
            print(f"   {s['skill']:<10} {s['requests']:>3} calls  ${s['cost']:.4f}  avg {s['avg_latency_ms'] / 1000:.1f}s")
        print("Quality:", ov["quality"])
    Path(args.report).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"\nReport saved to {args.report}; wall time {time.monotonic() - t0:.0f}s")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
