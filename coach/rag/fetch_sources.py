"""Fetch a curated source list into an ingestion manifest (verbatim, attributed).

Reads a sources file (default seed/rag_sources.json) — each entry carries the URL and
its first-class provenance (source, license, attribution). Fetches each page, extracts
the MAIN CONTENT verbatim with trafilatura (no nav/boilerplate, no paraphrase — so the
text is genuinely the licensed source, correctly attributable), and writes a manifest
that coach.rag.ingest_corpus can ingest through the governance gate.

    python -m coach.rag.fetch_sources --sources seed/rag_sources.json --out /tmp/corpus.json
    python -m coach.rag.ingest_corpus --manifest /tmp/corpus.json

Separating fetch from ingest keeps provenance auditable: you can eyeball the manifest
(what text, from where, under what license) before anything is embedded. Pages that fail
to fetch or yield too little text are reported and skipped, never silently dropped.

Tooling-only dependency: trafilatura (not a runtime dep of the app).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

MIN_CHARS = 400  # below this, extraction probably failed (JS page / blocked) — skip + report


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (gym-coach corpus builder)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def main() -> None:
    p = argparse.ArgumentParser(description="Build an ingestion manifest from a curated source list.")
    p.add_argument("--sources", default="seed/rag_sources.json")
    p.add_argument("--out", required=True, help="path to write the manifest JSON")
    args = p.parse_args()

    import trafilatura

    sources = json.loads(open(args.sources).read())
    manifest, skipped = [], []
    for s in sources:
        url, doc_id = s["url"], s["doc_id"]
        try:
            html = _fetch(url)
            text = trafilatura.extract(html, include_comments=False, include_tables=False) or ""
        except Exception as e:  # network / decode
            skipped.append((doc_id, f"fetch error: {e}"))
            print(f"  SKIP {doc_id}: fetch error: {str(e)[:80]}")
            continue
        text = text.strip()
        if len(text) < MIN_CHARS:
            skipped.append((doc_id, f"only {len(text)} chars extracted"))
            print(f"  SKIP {doc_id}: only {len(text)} chars (likely JS/blocked)")
            continue
        manifest.append({
            "doc_id": doc_id,
            "text": text,
            "source": s["source"],
            "license": s["license"],
            "url": url,
            "attribution": s.get("attribution"),
            "review_status": "approved",
        })
        print(f"  OK   {doc_id}: {len(text)} chars ({s['license']})")

    with open(args.out, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\nwrote {len(manifest)} docs to {args.out}; {len(skipped)} skipped")
    sys.exit(0 if manifest else 1)


if __name__ == "__main__":
    main()
