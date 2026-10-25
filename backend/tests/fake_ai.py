"""A fake Anthropic Messages API for tests and offline development.

It answers POST /v1/messages for the five NearbyNudge skills with plausible, schema-valid
answers built from the request itself (categories, candidates, page text, facts), so the whole
pipeline runs end to end without spending money. Tests can queue forced responses
(errors, malformed answers) with `FakeAI.force(...)`.

    python -m tests.fake_ai --port 8790     # then set ANTHROPIC_BASE_URL=http://127.0.0.1:8790
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import re
from collections import deque
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_ids = itertools.count(1)


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    out = []
    for block in content or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                out.append(block.get("text", ""))
            elif block.get("type") == "tool_result":
                c = block.get("content")
                out.append(c if isinstance(c, str) else _text_of(c))
    return "\n".join(out)


def _skill(system: Any) -> str:
    text = _text_of(system) if not isinstance(system, str) else system
    for name in ("Planner", "Scout", "Researcher", "Writer", "Editor"):
        if f"# NearbyNudge {name}" in text:
            return name.lower()
    if "Reply with the single word OK" in text:
        return "probe"
    return "unknown"


def _sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text)
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if len(p.split()) >= 6 and "[" not in p and "<" not in p]


class FakeAI:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.forced: deque[tuple[int, dict[str, Any] | None, dict[str, Any] | None]] = deque()
        self.forced_by_skill: dict[str, deque[tuple[int, dict[str, Any] | None, dict[str, Any] | None]]] = {}
        self.delay_by_skill: dict[str, float] = {}
        self.app = FastAPI()
        self.app.add_api_route("/v1/messages", self.messages, methods=["POST"])

    # ---------- test controls ----------

    def force(self, status: int = 200, *, body: dict[str, Any] | None = None, message: dict[str, Any] | None = None) -> None:
        """Queue the next response: an HTTP error (status + body) or a whole message (status 200)."""
        self.forced.append((status, body, message))

    def force_for(self, skill: str, status: int = 200, *, body: dict[str, Any] | None = None,
                  message: dict[str, Any] | None = None) -> None:
        """Queue the next response for one skill only (other skills answer normally)."""
        self.forced_by_skill.setdefault(skill, deque()).append((status, body, message))

    def calls_for(self, skill: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["skill"] == skill]

    # ---------- the endpoint ----------

    async def messages(self, request: Request) -> JSONResponse:
        req = await request.json()
        skill = _skill(req.get("system"))
        self.calls.append({"skill": skill, "request": req, "headers": dict(request.headers)})
        if self.delay_by_skill.get(skill):
            await asyncio.sleep(self.delay_by_skill[skill])
        queue = self.forced_by_skill.get(skill)
        if queue:
            status, body, message = queue.popleft()
            if status != 200:
                return JSONResponse(body or {"type": "error", "error": {"type": "api_error", "message": "forced"}}, status_code=status)
            if message is not None:
                return JSONResponse(self._wrap(message.get("content", []), message.get("stop_reason", "end_turn")))
        if self.forced:
            status, body, message = self.forced.popleft()
            if status != 200:
                return JSONResponse(body or {"type": "error", "error": {"type": "api_error", "message": "forced"}}, status_code=status)
            if message is not None:
                return JSONResponse(self._wrap(message.get("content", []), message.get("stop_reason", "end_turn")))
        handler = getattr(self, f"_{skill}", None)
        if handler is None:
            return JSONResponse(self._wrap([{"type": "text", "text": "OK"}], "end_turn"))
        return JSONResponse(handler(req))

    def _wrap(self, content: list[dict[str, Any]], stop_reason: str, *, inp: int = 1200, out: int = 300) -> dict[str, Any]:
        return {
            "id": f"msg_fake_{next(_ids)}", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "content": content, "stop_reason": stop_reason, "stop_sequence": None,
            "usage": {"input_tokens": inp, "output_tokens": out, "cache_creation_input_tokens": 0,
                      "cache_read_input_tokens": 0},
        }

    def _json(self, obj: dict[str, Any]) -> dict[str, Any]:
        return self._wrap([{"type": "text", "text": json.dumps(obj)}], "end_turn")

    def _user_text(self, req: dict[str, Any]) -> str:
        return "\n".join(_text_of(m.get("content")) for m in req.get("messages", []) if m.get("role") == "user")

    # ---------- skills ----------

    def _probe(self, req: dict[str, Any]) -> dict[str, Any]:
        return self._wrap([{"type": "text", "text": "OK"}], "end_turn", inp=20, out=2)

    def _planner(self, req: dict[str, Any]) -> dict[str, Any]:
        text = self._user_text(req)
        industry = (re.search(r"Industry \(user's words\): (.+)", text) or [None, ""])[1].strip().lower()
        stem = re.sub(r"(ists|ist|ies|s)$", "", industry.split()[0]) if industry else ""
        stem = {"dental": "dent", "dentist": "dent", "law": "law", "plumber": "plumb"}.get(stem, stem[:5])
        cats = re.findall(r"^- ([a-z0-9_]+) \| ([^|]+) \| (\d+)", text, re.MULTILINE)
        include = [k for k, label, _ in cats if stem and (stem in k or stem in label.lower()) and "ortho" not in k and "lab" not in k]
        question = None
        if any("orthodont" in k for k, _, _ in cats) and stem == "dent":
            question = {"text": "Include orthodontists?", "categories": [k for k, _, _ in cats if "orthodont" in k]}
        where = (re.search(r"Location: (.+?) \(", text) or [None, "the area"])[1]
        radius = (re.search(r"Radius: ([\d.]+) miles", text) or [None, "5"])[1]
        return self._json({
            "restatement": f"{industry.capitalize() or 'Businesses'} within {radius} miles of {where}. Leaving out chains with 10+ locations.",
            "include": include, "question": question, "warning": None,
        })

    def _scout(self, req: dict[str, Any]) -> dict[str, Any]:
        text = self._user_text(req)
        ids = re.findall(r"^- id=(c\d+) \| ([^|]+) \|", text, re.MULTILINE)
        ranking = [{"id": cid, "score": max(40, 92 - 4 * i), "reason": f"Independent local business; good match for the offer ({name.strip()})."}
                   for i, (cid, name) in enumerate(ids)]
        return self._json({"ranking": ranking})

    def _researcher(self, req: dict[str, Any]) -> dict[str, Any]:
        msgs = req.get("messages", [])
        if any(t.get("type", "").startswith("web_search") for t in req.get("tools", [])):
            # no website: pretend the one search found nothing current about the business
            return self._json({"summary": "A local business.", "owner_name": None, "facts": [],
                               "verification": {"operating": "unclear", "address_match": "unclear",
                                                "closed_signal": False, "note": "No current page about it turned up."}})
        has_results = any(isinstance(m.get("content"), list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in m["content"])
                          for m in msgs if m.get("role") == "user")
        first = _text_of(msgs[0].get("content")) if msgs else ""
        if not has_results:
            links = re.findall(r"^\d+\. (\S+) \|", first, re.MULTILINE)
            wanted = [u for u in links if re.search(r"about|contact|service|team|new-patients", u)][:3] or links[:2]
            return self._wrap([{"type": "tool_use", "id": f"toolu_fake_{next(_ids)}", "name": "read_pages", "input": {"urls": wanted}}],
                              "tool_use")
        all_text = self._user_text(req)
        pages = re.findall(r'<page url="([^"]+)" label="[^"]*" fetched="[^"]*">\n(.*?)\n</page>', all_text, re.DOTALL)
        facts = []
        closed = False
        owner = None
        for url, body in pages:
            if re.search(r"permanently closed|has closed|closed its doors", body, re.IGNORECASE):
                closed = True
            m = re.search(r"\b(Dr\. [A-Z][a-z]+ [A-Z][a-z]+)\b", body)
            if m and not owner:
                owner = m.group(1)
            for sent in _sentences(body)[:2]:
                if "ignore all previous instructions" in sent.lower():
                    continue
                words = sent.split()
                quote = " ".join(words[: min(len(words), 14)])
                facts.append({"text": sent[:200], "quote": quote, "url": url})
        return self._json({
            "summary": "A local business serving its community.",
            "owner_name": owner,
            "facts": facts[:6],
            "verification": {"operating": "no" if closed else "yes", "address_match": "unclear" if closed else "yes",
                             "closed_signal": closed, "note": "The site says it has closed." if closed else "The site shows the business operating."},
        })

    def _writer(self, req: dict[str, Any]) -> dict[str, Any]:
        text = self._user_text(req)
        mode = (re.search(r"^Mode: (\w+)", text, re.MULTILINE) or [None, "email"])[1]
        facts = re.findall(r"^(F\d+)\. (.+?) \[Source:", text, re.MULTILINE)
        if mode == "strategy":
            booking = next((pid for pid, t in facts if "booking" in t.lower()), None)
            first = facts[0][0] if facts else None
            hook_ids = [booking or first] if (booking or first) else []
            alts = [{"kind": "site_gap", "title": "Mobile layout", "reason": "A phone-friendly site helps ads convert.", "fact_ids": [facts[-1][0]] if facts else []},
                    {"kind": "good_news", "title": "Long history", "reason": "Their years of service make a strong ad message.", "fact_ids": [first] if first else []}]
            return self._json({
                "fit_score": 86, "fit_reason": "Independent practice; booking is by phone, which ads can fix.",
                "hook": {"kind": "no_online_booking" if booking else "other", "title": "No online booking" if booking else "Local reputation",
                         "reason": "Patients from ads can't book online yet, so the offer fits.", "fact_ids": hook_ids},
                "alternatives": alts,
            })
        short = (re.search(r"Short name for the subject and greeting: (.+)", text) or [None, "your business"])[1].strip()
        owner = (re.search(r"Published owner or lead practitioner: (.+)", text) or [None, None])[1]
        sells = (re.search(r"What the sender sells: (.+)", text) or [None, "our service"])[1].strip()
        ask = (re.search(r"The ask \(call to action\): (.+)", text) or [None, "a short call"])[1].strip()
        proof = (re.search(r"Proof point: (.+)", text) or [None, ""])[1].strip()
        cite = facts[0][0] if facts else None
        claim_text = facts[0][1].rstrip(".") if facts else "your practice serves the area"
        greeting = f"Hi {owner.split()[0]} {owner.split()[-1]}," if owner else f"Hello {short} team,"
        para1 = [{"text": f"I was reading about {short} and noticed this: {claim_text[0].lower() + claim_text[1:]}.", "kind": "claim",
                  "fact_ids": [cite] if cite else []}]
        para2 = [
            {"text": f"We provide {sells[0].lower() + sells[1:]} for local practices, and we focus on turning more of your existing visitors into booked appointments.", "kind": "offer", "fact_ids": []},
            {"text": (f"For example, we {proof[0].lower() + proof[1:].rstrip('.')}." if proof and "none" not in proof.lower() else
                      "Our work is simple to start and easy to measure from the first week."), "kind": "offer", "fact_ids": []},
        ]
        para3 = [{"text": f"Would you be open to {ask[0].lower() + ask[1:].rstrip('.')} next week to see whether it could help {short} as well?", "kind": "other", "fact_ids": []},
                 {"text": "If the timing is not right, no problem at all, and thank you for reading this note.", "kind": "other", "fact_ids": []}]
        if mode == "rewrite" and "shorter" in text:
            para2 = para2[:1]
        return self._json({"subject": f"A quick idea for {short}", "greeting": greeting,
                           "paragraphs": [para1, para2, para3], "signoff": "Best,"})

    def _editor(self, req: dict[str, Any]) -> dict[str, Any]:
        text = self._user_text(req)
        ids = re.findall(r"^\s+(S\d+) \[", text, re.MULTILINE)
        return self._json({
            "checks": {k: {"passed": True, "note": None} for k in ("facts", "rules", "spam", "subject")},
            "sentences": [{"id": i, "supported": True, "note": None} for i in ids],
            "fixes": [], "fixed_email": None,
        })


def main() -> None:
    import uvicorn

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8790)
    args = p.parse_args()
    uvicorn.run(FakeAI().app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
