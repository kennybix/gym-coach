"""Corpus governance — the gate. Nothing reaches the retriever unless it clears this.

This is the same stance as the calorie floors: make the unsafe/illegitimate thing
unreachable by construction, rather than relying on discipline at query time. For a
public-domain / openly-licensed corpus, copyrighted or unknown-license material is
rejected at ingestion and never embedded.
"""
from __future__ import annotations

from .models import License, Provenance

# Allowlist for a public-domain / openly-licensed corpus (owned/licensed kept for later).
INGESTABLE = {
    License.public_domain, License.cc0, License.cc_by, License.cc_by_sa,
    License.open_gov, License.owned, License.licensed,
}
ATTRIBUTION_REQUIRED = {License.cc_by, License.cc_by_sa}


class GovernanceError(Exception):
    pass


def check_ingestable(prov: Provenance) -> None:
    if prov.license not in INGESTABLE:
        raise GovernanceError(f"license '{prov.license.value}' is not ingestable")
    if prov.review_status != "approved":
        raise GovernanceError(f"review status '{prov.review_status}' is not approved")
    if prov.license in ATTRIBUTION_REQUIRED and not prov.attribution:
        raise GovernanceError(f"attribution is required for license '{prov.license.value}'")
