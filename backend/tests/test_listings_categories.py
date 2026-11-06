"""Category labels, LD2 excluded categories and listing match keys (track L). Offline."""

from __future__ import annotations

import pytest

from nearbynudge.listings import categories
from nearbynudge.listings.categories import EXCLUDED_KEYWORDS, excluded_group, is_excluded, label_for
from nearbynudge.listings.keys import (
    bbox_around,
    dedupe_key,
    exclusion_keys,
    haversine_mi,
    host_of,
    phone_key,
    place_keys,
    registrable_domain,
    website_keys,
)

# ---------------------------------------------------------------- labels


@pytest.mark.parametrize(
    "key, label",
    [
        ("general_dentistry", "General dentistry"),
        ("dental_clinic", "Dental clinic"),
        ("hvac_service", "HVAC service"),
        ("attorney_or_law_firm", "Attorney or law firm"),
        ("it_service_and_computer_repair", "IT service and computer repair"),
        ("dj_service", "DJ service"),
        ("cpa", "CPA"),
        ("bbq_restaurant", "BBQ restaurant"),
        ("atm", "ATM"),
        ("rv_dealer", "RV dealer"),
        ("b2b_service", "B2B service"),
        ("mexican_restaurant", "Mexican restaurant"),
        ("south_asian_restaurant", "South Asian restaurant"),
        ("latin_american_restaurant", "Latin American restaurant"),
        ("middle_eastern_restaurant", "Middle Eastern restaurant"),
        ("hong_kong_style_cafe", "Hong Kong style cafe"),
        ("childrens_clothing_store", "Children's clothing store"),
        ("jehovahs_witness_place_of_worship", "Jehovah's Witness place of worship"),
        ("t_shirt_store", "T-shirt store"),
        ("restaurant", "Restaurant"),
    ],
)
def test_label_for(key, label):
    assert label_for(key) == label


def test_label_for_missing_key():
    assert label_for(None) == "Business"
    assert label_for("") == "Business"


# ---------------------------------------------------------------- excluded categories


def test_excluded_groups_cover_the_prd_list():
    assert set(EXCLUDED_KEYWORDS) == {
        "adult", "cannabis", "firearms", "gambling", "tobacco", "payday loans", "political", "religious"}


@pytest.mark.parametrize(
    "category, group",
    [
        ("adult_store", "adult"), ("adult_entertainment_venue", "adult"), ("strip_club", "adult"),
        ("erotic_massage_venue", "adult"), ("sex_shop", "adult"),
        ("cannabis_dispensary", "cannabis"), ("cannabis_clinic", "cannabis"),
        ("medical_cannabis_referral", "cannabis"), ("marijuana_delivery", "cannabis"), ("dispensary", "cannabis"),
        ("gun_and_ammo_store", "firearms"), ("gunsmith", "firearms"), ("firearm_training", "firearms"),
        ("shooting_range", "firearms"), ("ammunition_store", "firearms"),
        ("casino", "gambling"), ("betting_center", "gambling"), ("bingo_hall", "gambling"),
        ("lottery_vendor", "gambling"), ("horse_racing_track", "gambling"), ("gambling_hall", "gambling"),
        ("tobacco_shop", "tobacco"), ("tobacco_company", "tobacco"), ("smoke_and_vape_store", "tobacco"),
        ("vape_shop", "tobacco"), ("hookah_bar", "tobacco"), ("cigar_bar", "tobacco"), ("smoke_shop", "tobacco"),
        ("check_cashing_payday_loans", "payday loans"), ("payday_lender", "payday loans"),
        ("pawn_shop", "payday loans"), ("title_loans", "payday loans"),
        ("political_organization", "political"), ("political_party_office", "political"),
        ("campaign_office", "political"),
        ("place_of_worship", "religious"), ("christian_place_of_worship", "religious"),
        ("roman_catholic_place_of_worship", "religious"), ("religious_organization", "religious"),
        ("religious_school", "religious"), ("church", "religious"), ("mosque", "religious"),
        ("synagogue", "religious"), ("hindu_temple", "religious"), ("cathedral", "religious"),
        ("monastery", "religious"), ("convent", "religious"), ("seminary", "religious"),
        ("hindu_ashram", "religious"),
    ],
)
def test_excluded_categories(category, group):
    assert excluded_group(category) == group
    assert is_excluded(category, None)


@pytest.mark.parametrize(
    "category",
    [
        "adult_education_center", "adult_day_care_center", "arcade", "escape_room", "race_track",
        "go_kart_track", "motor_race_track", "track_and_field_track", "smokehouse", "wedding_chapel",
        "religious_and_spiritual_goods_store", "church_supply_store", "christian_goods_store",
        "lingerie_store", "sex_therapy", "installment_loans", "auto_loan_provider", "massage_therapy",
        "jewish_restaurant", "historic_mission", "transmission_repair", "general_dentistry",
        "hvac_service", "gaming_venue", "templeton", "gunther", "begun", "pawnee_tours",
    ],
)
def test_not_excluded(category):
    assert not is_excluded(category, None)


def test_hierarchy_elements_count():
    hierarchy = ["shopping", "specialty_store", "smoke_and_vape_store", "cannabis_dispensary"]
    assert is_excluded("cannabis_dispensary", hierarchy)
    assert is_excluded("something_new", ["cultural_and_historic", "place_of_worship", "something_new"])
    assert not is_excluded("adult_education_center", ["education", "place_of_learning", "adult_education_center"])
    assert not is_excluded(None, None)
    assert not is_excluded(None, [])


def test_rules_fingerprint_is_stable():
    assert categories.rules_fingerprint() == categories.rules_fingerprint()
    assert len(categories.rules_fingerprint()) == 16


# ---------------------------------------------------------------- website, phone and distance keys


@pytest.mark.parametrize(
    "url, host",
    [
        ("https://WWW.Smile.com/about?x=1", "smile.com"),
        ("smile.com", "smile.com"),
        ("http://www2.smile.com:8080/", "smile.com"),
        ("//arlington.smile.com", "arlington.smile.com"),
        ("https://user:pw@smile.com/", "smile.com"),
        ("", None),
        (None, None),
        ("not a url", None),
        ("localhost", None),
    ],
)
def test_host_of(url, host):
    assert host_of(url) == host


def test_registrable_domain():
    assert registrable_domain("arlington.smile.com") == "smile.com"
    assert registrable_domain("smile.com") == "smile.com"
    assert registrable_domain("shop.example.co.uk") == "example.co.uk"
    assert registrable_domain("10.0.0.1") == "10.0.0.1"


def test_website_keys_and_dedupe_keys():
    assert website_keys("https://www.smile.com/arlington") == {"smile.com"}
    assert website_keys("https://arlington.smile.com") == {"arlington.smile.com", "smile.com"}
    assert website_keys("https://www.facebook.com/SmileDental/") == {"facebook.com/smiledental"}
    assert website_keys("https://facebook.com") == set()
    assert website_keys("https://linktr.ee/dr_a") == {"linktr.ee/dr_a"}
    assert website_keys("https://sites.google.com/view/smile/home") == {"sites.google.com/view/smile"}
    assert website_keys("https://www.google.com/maps/place/x") == set()
    assert website_keys("https://smile.business.site/") == {"smile.business.site"}
    assert website_keys("https://hubcapdave.bandzoogle.com") == {"hubcapdave.bandzoogle.com"}
    assert dedupe_key("https://www.smile.com/arlington") == "smile.com"
    assert dedupe_key("https://arlington.smile.com") == "arlington.smile.com"
    assert dedupe_key("https://www.facebook.com/SmileDental") == "facebook.com/smiledental"
    assert dedupe_key("https://www.facebook.com/") is None
    assert dedupe_key("") is None


@pytest.mark.parametrize(
    ("url", "key"),
    [
        ("https://www.facebook.com/p/Smile-Dental-100063123456789/", "facebook.com/p/smile-dental-100063123456789"),
        ("https://www.facebook.com/profile.php?id=100063123456789", "facebook.com/profile.php?id=100063123456789"),
        ("https://m.facebook.com/profile.php?ref=bookmarks&id=100063123456789#about", "facebook.com/profile.php?id=100063123456789"),
        ("https://www.facebook.com/profile.php", None),
        ("https://www.facebook.com/profile.php?id=", None),
        ("https://www.facebook.com/people/Smile-Dental/100063123456789/", "facebook.com/people/smile-dental/100063123456789"),
        ("https://www.facebook.com/pages/Smile-Dental/123456789", "facebook.com/pages/smile-dental/123456789"),
        ("https://www.facebook.com/pages/category/Dentist/Smile-Dental-123/", "facebook.com/pages/category/dentist/smile-dental-123"),
        ("https://www.facebook.com/pg/SmileDental/about/", "facebook.com/pg/smiledental"),
        ("https://www.facebook.com/SmileDental/about", "facebook.com/smiledental"),
        ("https://www.facebook.com/p/", None),
        ("https://www.facebook.com/sharer/sharer.php?u=https://smile.com", None),
        ("https://www.youtube.com/channel/UCabc123", "youtube.com/channel/ucabc123"),
        ("https://www.youtube.com/c/SmileDental/videos", "youtube.com/c/smiledental"),
        ("https://www.youtube.com/user/smiledental", "youtube.com/user/smiledental"),
        ("https://www.youtube.com/@SmileDental", "youtube.com/@smiledental"),
        ("https://www.youtube.com/watch?v=abc123", None),
        ("https://www.instagram.com/p/C1x2y3/", "instagram.com/p/c1x2y3"),
        ("https://www.instagram.com/smiledental/", "instagram.com/smiledental"),
    ],
)
def test_platform_pages_are_keyed_by_the_page(url, key):
    assert dedupe_key(url) == key
    assert website_keys(url) == ({key} if key else set())


def test_international_domains_are_keyed_in_ascii():
    assert website_keys("https://www.café.com/menu") == {"xn--caf-dma.com"}
    assert dedupe_key("https://www.café.com/") == dedupe_key("https://www.xn--caf-dma.com/") == "xn--caf-dma.com"
    assert exclusion_keys("café.com") == exclusion_keys("xn--caf-dma.com") == {"xn--caf-dma.com"}
    assert website_keys("https://😀.example/") == {"😀.example"}  # not a valid international name: as written


def test_exclusion_keys_for_platform_pages():
    assert exclusion_keys("https://www.facebook.com/p/Smile-Dental-100063/") == {"facebook.com/p/smile-dental-100063"}
    assert exclusion_keys("facebook.com/profile.php?id=42") == {"facebook.com/profile.php?id=42"}
    assert exclusion_keys("https://www.youtube.com/channel/UCabc123") == {"youtube.com/channel/ucabc123"}


def test_exclusion_keys():
    assert exclusion_keys("WWW.Smile.com") == {"smile.com"}
    assert exclusion_keys("https://smile.com/contact") == {"smile.com"}
    assert exclusion_keys("linktr.ee") == {"linktr.ee"}
    assert exclusion_keys("https://linktr.ee/dr_a") == {"linktr.ee/dr_a"}
    assert exclusion_keys("") == set()


def test_phone_key():
    assert phone_key("+1 (703) 555-0101") == "7035550101"
    assert phone_key("7035550101") == "7035550101"
    assert phone_key("555-0101") is None
    assert phone_key("0000000000") is None
    assert phone_key(None) is None


def test_place_keys():
    sites, webs, tels = place_keys(
        ["https://www.smile.com", "https://www.facebook.com/smile", "https://www.facebook.com/"],
        ["+17035550101", "7035550101", "12"],
    )
    assert sites == ["facebook.com/smile", "smile.com"]
    assert webs == ["facebook.com/smile", "smile.com"]
    assert tels == ["7035550101"]
    assert place_keys(None, None) == ([], [], [])


def test_distances():
    assert haversine_mi(38.8816, -77.0910, 38.8816, -77.0910) == 0
    # Arlington, VA to Washington, DC (Census internal points): about 4.9 miles
    assert haversine_mi(38.878337, -77.100703, 38.904243, -77.016524) == pytest.approx(4.9, abs=0.3)
    xmin, ymin, xmax, ymax = bbox_around(38.8816, -77.0910, 5)
    assert haversine_mi(38.8816, -77.0910, ymax, -77.0910) == pytest.approx(5, rel=1e-3)
    assert haversine_mi(38.8816, -77.0910, 38.8816, xmax) == pytest.approx(5, rel=1e-2)
