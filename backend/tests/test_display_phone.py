"""Phone numbers are shown the way people write them: (703) 270-0466 for U.S. numbers, others as listed."""

from __future__ import annotations

import csv
import io
import re

from nearbynudge.listings.keys import display_phone
from tests.conftest import Api
from tests.test_pipeline import start_campaign, wait_done

US = re.compile(r"^\(\d{3}\) \d{3}-\d{4}$")


def test_display_phone_formats_us_numbers_and_leaves_others_alone():
    assert display_phone("+17032700466") == "(703) 270-0466"
    assert display_phone("17032700466") == "(703) 270-0466"
    assert display_phone("7032700466") == "(703) 270-0466"
    assert display_phone("703.270.0466") == "(703) 270-0466"
    assert display_phone("+1 (703) 270-0466") == "(703) 270-0466"
    assert display_phone("(703) 270-0466") == "(703) 270-0466"
    assert display_phone("+44 20 7946 0958") == "+44 20 7946 0958"  # not a U.S. number
    assert display_phone("+3912345678") == "+3912345678"  # ten digits, but Italian
    assert display_phone("703-270-0466 ext. 12") == "703-270-0466 ext. 12"  # keep the extension
    assert display_phone(" 555-0100 ") == "555-0100"  # too short to format
    assert display_phone(None) is None
    assert display_phone("   ") is None


def test_leads_and_the_csv_export_show_formatted_phones(api: Api):
    api.onboard()
    _, camp = start_campaign(api, answer="no")
    wait_done(api, camp["id"])
    phones = [api.get(f"/api/leads/{ld['id']}").json()["phone"]
              for ld in api.get(f"/api/campaigns/{camp['id']}/leads").json()]
    assert phones and all(US.match(p) for p in phones if p is not None), phones
    r = api.get(f"/api/campaigns/{camp['id']}/export.csv")
    assert r.status_code == 200, r.text
    rows = list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows and all(US.match(row["Phone"]) for row in rows if row["Phone"]), [row["Phone"] for row in rows]
