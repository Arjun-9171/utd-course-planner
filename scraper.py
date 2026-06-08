"""
scraper.py

Scrapes course data from the UTD undergraduate Computer Science catalog page
and uploads each course document to Firestore collection `courses`.

Usage:
  python scraper.py

Options:
  --url URL         : Override default catalog URL
  --limit N         : Limit number of courses (for testing)
  --sleep SEC       : Seconds to sleep between requests (default 1.0)
  --dry-run         : Parse but do not upload to Firestore

Requirements:
  pip install requests beautifulsoup4 firebase-admin

Assumes `firebase-key.json` is present in the current working directory.
"""

import requests
from bs4 import BeautifulSoup
import re
import time
import json
import os
import argparse
import logging
from typing import List, Dict

# Firebase imports are optional; if unavailable we can run in dry-run mode
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except Exception:
    firebase_admin = None
    credentials = None
    firestore = None

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

DEFAULT_URL = "https://catalog.utdallas.edu/2025/undergraduate/programs/ecs/computer-science"
FIREBASE_KEY = os.getenv("FIREBASE_KEY_PATH", "firebase-key.json")

COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,4})\s*-?\s*(\d{3,4})\b")
CRED_RE = re.compile(r"(\d+)\s*(?:semester\s*)?(?:credit|credit hours)", re.IGNORECASE)


def normalize_course_id(dept: str, num: str) -> str:
    return f"{dept.upper()}{num}"


def extract_course_heading(soup: BeautifulSoup) -> Dict[str, str]:
    """Try to find course code, title and credits from page soup."""
    text = soup.get_text(" ", strip=True)

    # Try to find a heading-like line that contains code + title + credits
    # Search for patterns like "CS 1337 - Computer Science I (3 semester credit hours)"
    heading_match = re.search(r"([A-Z]{2,4})\s*-?\s*(\d{3,4})[\s\S]{0,120}?([-–—:\.]\s*)?([A-Za-z0-9 ,&'\-/\(\)]+?)\s*\(?\s*(\d+)\s*(?:semester)?\s*(?:credit|credit hours)", text)
    if heading_match:
        dept, num, _, title, credits = heading_match.groups()
        return {"dept": dept, "number": num, "title": title.strip(". "), "credits": int(credits)}

    # Fallback: find first course code appearance and try to get title and credits nearby
    code_search = COURSE_CODE_RE.search(text)
    if code_search:
        dept, num = code_search.groups()
        # Attempt to find credit near code
        slice_start = max(0, code_search.start() - 200)
        slice_end = min(len(text), code_search.end() + 300)
        window = text[slice_start:slice_end]
        cred_match = CRED_RE.search(window)
        credits = int(cred_match.group(1)) if cred_match else None
        # heuristically extract title: the words after the code up to a period or credits phrase
        after = text[code_search.end():code_search.end()+200]
        after = after.strip(" .-–—:\n")
        # cut title at first parentheses or credit phrase
        title_cut = re.split(r"\(|\d+\s*(?:semester)?\s*(?:credit|credit hours)", after)[0]
        title = title_cut.split(". ")[0].strip(" .-")
        return {"dept": dept, "number": num, "title": title or "", "credits": credits or 0}

    # Nothing found
    return {"dept": "", "number": "", "title": "", "credits": 0}


def extract_prereqs(text: str) -> List[str]:
    """Find prerequisite course codes in a block of text."""
    # Look for the Prerequisite(s) line
    m = re.search(r"Prerequisite[s]?:\s*([^\n\r]+)", text, re.IGNORECASE)
    block = m.group(1) if m else text
    codes = COURSE_CODE_RE.findall(block)
    normalized = [normalize_course_id(dept, num) for dept, num in codes]
    # dedupe while preserving order
    seen = set()
    out = []
    for c in normalized:
        if c not in seen:
            out.append(c)
            seen.add(c)
    return out


def find_course_links(main_url: str, session: requests.Session) -> List[str]:
    """Find candidate links on the main catalog page that likely point to course descriptions."""
    logging.info("Fetching main catalog page: %s", main_url)
    r = session.get(main_url, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    links = []
    for a in soup.find_all("a", href=True):
        text = (a.get_text(" ", strip=True) or "")
        # If link text contains a course code, treat it as a course link
        if COURSE_CODE_RE.search(text):
            href = a["href"]
            # build absolute URL if necessary
            if href.startswith("/"):
                base = re.match(r"(https?://[^/]+)", main_url).group(1)
                href = base + href
            elif not href.startswith("http"):
                href = requests.compat.urljoin(main_url, href)
            links.append(href)

    # dedupe preserving order
    seen = set()
    out = []
    for l in links:
        if l not in seen:
            out.append(l)
            seen.add(l)
    logging.info("Found %d candidate course links", len(out))
    return out


def parse_course_page(url: str, session: requests.Session) -> Dict:
    logging.info("Parsing %s", url)
    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
    except Exception as e:
        logging.warning("Failed to fetch %s: %s", url, e)
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    heading = extract_course_heading(soup)
    page_text = soup.get_text(" ", strip=True)
    prereqs = extract_prereqs(page_text)

    dept = heading.get("dept")
    num = heading.get("number")
    title = heading.get("title") or ""
    credits = heading.get("credits") or 0

    if not dept or not num:
        # try to extract from URL as last resort
        uu = re.search(r"([A-Z]{2,4})[-_ ]?(\d{3,4})", url, re.IGNORECASE)
        if uu:
            dept, num = uu.groups()

    if not dept or not num:
        logging.warning("Could not determine course code for %s", url)
        return None

    course_id = normalize_course_id(dept, num)

    # Ensure credits is int
    try:
        credits = int(credits)
    except Exception:
        credits = 0

    return {"id": course_id, "title": title, "credits": credits, "prereqs": prereqs}


def init_firestore(key_path: str):
    if firebase_admin is None:
        raise RuntimeError("firebase_admin package is not installed")
    if not os.path.isfile(key_path):
        raise FileNotFoundError(f"Firebase key file not found: {key_path}")

    # Avoid initializing twice (Flask dev server or repeated runs)
    if not getattr(firebase_admin, "_apps", None):
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--limit", type=int, default=0, help="Limit number of courses to fetch (0 = no limit)")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to sleep between requests")
    parser.add_argument("--dry-run", action="store_true", help="Do not upload to Firestore; instead save to local JSON")
    parser.add_argument("--key", default=FIREBASE_KEY, help="Path to firebase service account JSON")
    args = parser.parse_args()

    session = requests.Session()
    course_links = find_course_links(args.url, session)

    results = []
    for i, link in enumerate(course_links):
        if args.limit and i >= args.limit:
            break
        course = parse_course_page(link, session)
        if course:
            results.append(course)
        time.sleep(max(0.1, args.sleep))

    if not results:
        logging.error("No courses parsed; exiting")
        return

    # Prepare dicts for upload
    docs = {}
    for c in results:
        docs[c["id"]] = {"title": c["title"], "credits": c["credits"], "prereqs": c["prereqs"]}

    if args.dry_run or firebase_admin is None:
        # Save to local JSON and print summary
        out_path = "courses_export.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(docs, f, indent=2)
        logging.info("Wrote %d course entries to %s", len(docs), out_path)
        if firebase_admin is None:
            logging.warning("firebase_admin not available; run `pip install firebase-admin` and provide --key to upload")
        return

    # Upload to Firestore
    try:
        db = init_firestore(args.key)
    except Exception as e:
        logging.error("Failed to initialize Firestore: %s", e)
        # fallback: write JSON
        with open("courses_export.json", "w", encoding="utf-8") as f:
            json.dump(docs, f, indent=2)
        logging.info("Saved output to courses_export.json")
        return

    failed = []
    for cid, payload in docs.items():
        try:
            db.collection("courses").document(cid).set(payload)
            logging.info("Uploaded %s", cid)
        except Exception as e:
            logging.error("Failed to upload %s: %s", cid, e)
            failed.append(cid)

    logging.info("Upload complete: %d succeeded, %d failed", len(docs) - len(failed), len(failed))
    if failed:
        logging.warning("Failed uploads: %s", ",".join(failed))


if __name__ == "__main__":
    main()
