"""Unit tests: email rules and text, pricing, schemas, the AI client's error handling."""

from __future__ import annotations

import anthropic
import httpx2
import pytest

from nearbynudge import emailtext
from nearbynudge.ai.client import AIClient, AIPaused, AIRefusal, AIUnavailable, CallContext, StructuredOutputError
from nearbynudge.ai.pricing import cost_usd
from nearbynudge.roles.outputs import PlanOut
from nearbynudge.schemas import CampaignInput, SenderProfile
from tests.fake_ai import FakeAI

PROFILE = {"sender_name": "Maya Chen", "sender_title": "Founder", "sender_company": "Brightline Ads",
           "sender_address": "123 Example St\nArlington, VA 22201"}


def para(*texts, kind="other"):
    return [{"text": t, "kind": kind, "fact_ids": []} for t in texts]


def test_footer_and_copy_text():
    footer = emailtext.build_footer(PROFILE)
    assert footer.splitlines()[:4] == ["Maya Chen", "Founder, Brightline Ads", "123 Example St", "Arlington, VA 22201"]
    assert "This email is a business offer from Brightline Ads." in footer
    assert footer.endswith('Not interested? Reply "no thanks" and I won\'t email again.')
    text = emailtext.copy_text("Online booking at Sample Studio?", "Hi Dr. Lee,", [para("First.", "Second.")], "Best,", footer)
    assert text.startswith("Subject: Online booking at Sample Studio?\n\nHi Dr. Lee,\n\nFirst. Second.\n\nBest,\nMaya Chen")


def test_mailto_is_rfc6068():
    url = emailtext.mailto_url("office@studio.example", "Hi & hello?", "Line one\nLine two")
    assert url.startswith("mailto:office@studio.example?subject=Hi%20%26%20hello%3F&body=")
    assert "Line%20one%0D%0ALine%20two" in url


def test_sentence_split_keeps_abbreviations():
    s = emailtext.split_sentences("Dr. Lee has served Arlington since 2009. We help practices. Is Mon. 9 a.m. open?")
    assert s == ["Dr. Lee has served Arlington since 2009.", "We help practices.", "Is Mon. 9 a.m. open?"]


def test_parse_body_finds_greeting_and_signoff():
    g, paras, sign = emailtext.parse_body("Hi Dr. Lee,\n\nFirst point. Second point.\n\nThird.\n\nBest,")
    assert g == "Hi Dr. Lee," and sign == "Best," and paras == [["First point.", "Second point."], ["Third."]]


def test_rule_checks():
    long_subject = "This subject line is clearly far too long for any business email"
    issues = emailtext.rule_checks(subject=long_subject, greeting="Hi,", paragraphs=[para("Short.")], signoff="Best,",
                                   business_name="Sample Dental Studio, PC")
    keys = {i.key for i in issues}
    assert "subject" in keys and "rules" in keys
    body = ["I hope this email finds you well.", "Click here to act now!!!", "[First name], we can help."]
    issues = emailtext.rule_checks(subject="Idea for Sample Dental Studio", greeting="Hi,", paragraphs=[para(*body)],
                                   signoff="Best,", business_name="Sample Dental Studio")
    msgs = " ".join(i.message for i in issues)
    assert "cliché" in msgs and "act now" in msgs and "placeholder" in msgs
    assert emailtext.names_business("Online booking at Sample Studio?", "Sample Dental Studio - Dr. Lee DDS")
    assert not emailtext.names_business("A quick question", "Sample Dental Studio")


def test_pricing_sonnet_5_5():
    # 10K fresh input, 2K cache write, 20K cache read, 3K output, 1 web search
    c = cost_usd("claude-sonnet-5-5", input_tokens=10_000, cache_write_tokens=2_000, cache_read_tokens=20_000,
                 output_tokens=3_000, web_searches=1)
    assert c == pytest.approx((10_000 * 2 + 2_000 * 2.5 + 20_000 * 0.2 + 3_000 * 10) / 1e6 + 0.01)


def test_schemas_validate_inputs():
    with pytest.raises(ValueError):
        CampaignInput(location="A", industry="Dentists", offer_what="Ads", offer_cta="Call")
    inp = CampaignInput(location="  Arlington,   VA ", industry="Dentists", offer_what="Google Ads", offer_cta="Call")
    assert inp.location == "Arlington, VA" and inp.radius_mi == 5 and inp.lead_target == 10
    with pytest.raises(ValueError):
        SenderProfile(sender_name="M", sender_company="B", sender_address="123 Example St", timezone="Mars/Base")


def _client(fake: FakeAI, **kw) -> AIClient:
    http = anthropic.DefaultAsyncHttpxClient(transport=httpx2.ASGITransport(app=fake.app))
    return AIClient(api_key="sk-ant-test", base_url="http://fake-ai", http_client=http, max_retries=0, **kw)


class Pause:
    def __init__(self):
        self.calls = []

    def pause(self, reason, *, seconds):
        self.calls.append((reason, seconds))


async def test_ai_client_errors_map_to_pauses():
    fake = FakeAI()
    pause = Pause()
    ai = _client(fake, pause=pause)
    ctx = CallContext(skill="planner")
    fake.force(401, body={"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
    with pytest.raises(AIPaused):
        await ai.create(ctx, system="# NearbyNudge Planner", messages=[{"role": "user", "content": "hi"}])
    fake.force(529, body={"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
    with pytest.raises(AIUnavailable):
        await ai.create(ctx, system="# NearbyNudge Planner", messages=[{"role": "user", "content": "hi"}])
    fake.force(429, body={"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}})
    with pytest.raises(AIUnavailable):
        await ai.create(ctx, system="# NearbyNudge Planner", messages=[{"role": "user", "content": "hi"}])
    assert [r for r, _ in pause.calls] == ["auth", "down", "rate_limited"]
    fake.force(200, message={"content": [{"type": "text", "text": ""}], "stop_reason": "refusal"})
    with pytest.raises(AIRefusal):
        await ai.create(ctx, system="# NearbyNudge Planner", messages=[{"role": "user", "content": "hi"}])
    await ai.aclose()


async def test_structured_asks_once_more_then_gives_up():
    fake = FakeAI()
    recorded = []

    async def recorder(ctx, row):
        recorded.append(row)

    ai = _client(fake, recorder=recorder)
    for _ in range(2):
        fake.force(200, message={"content": [{"type": "text", "text": "not json"}]})
    with pytest.raises(StructuredOutputError):
        await ai.structured(CallContext(skill="planner"), system="# NearbyNudge Planner", user="hi", output=PlanOut)
    assert len(recorded) == 2 and all(r["status"] == "ok" for r in recorded)
    assert all(r["cost_usd"] > 0 for r in recorded)
    await ai.aclose()


def test_release_check_passes_and_catches_new_connections(tmp_path):
    from nearbynudge.checks import check_connections
    from nearbynudge.config import ROOT

    assert [p for p in check_connections(ROOT) if p.startswith("backend/")] == []
    pkg = tmp_path / "backend" / "nearbynudge"
    pkg.mkdir(parents=True)
    (pkg / "tracker.py").write_text('import httpx\nURL = "https://analytics.tracker.test/collect"\nhttpx.post(URL)\n')
    problems = check_connections(tmp_path)
    assert any("tracker.py: opens network connections" in p for p in problems)
    assert any("analytics.tracker.test" in p for p in problems)


def test_sentence_states_follow_the_proof_rules():
    from types import SimpleNamespace

    from nearbynudge.pipeline.serialize import sentence_state

    ok = SimpleNamespace(flagged_wrong=False, quote_found=True)
    wrong = SimpleNamespace(flagged_wrong=True, quote_found=True)
    unquoted = SimpleNamespace(flagged_wrong=False, quote_found=False)
    facts = {"f1": ok, "f2": wrong, "f3": unquoted}
    claim = {"kind": "claim", "verified": True, "edited": False}
    assert sentence_state({**claim, "fact_ids": ["f1"]}, facts) == "supported"
    assert sentence_state({**claim, "fact_ids": []}, facts) == "no_source"
    assert sentence_state({**claim, "fact_ids": ["f1", "f2"]}, facts) == "check"  # a cited fact was flagged wrong
    assert sentence_state({**claim, "fact_ids": ["f3"]}, facts) == "check"  # quote not found on the page
    assert sentence_state({**claim, "fact_ids": ["f1"], "verified": False}, facts) == "check"  # editor didn't confirm
    assert sentence_state({**claim, "fact_ids": ["f1"], "edited": True}, facts) == "check"  # changed by the user
    assert sentence_state({"kind": "offer", "fact_ids": []}, facts) == "none"


def test_display_url_only_allows_web_links():
    from nearbynudge.pipeline.serialize import display_url

    assert display_url("https://studio.example/") == "https://studio.example/"
    assert display_url("studio.example") == "https://studio.example"
    assert display_url("javascript:alert(1)") is None
    assert display_url("data:text/html,hi") is None
    assert display_url("ftp://files.example") is None
    assert display_url(None) is None
