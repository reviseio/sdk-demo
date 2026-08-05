/**
 * The document under review. Markdown rather than a .docx binary so the demo
 * is a text repo — the SDK infers the format from the filename.
 */
const NDA = `# Mutual Non-Disclosure Agreement

This Agreement is entered into between Northwind Analytics, Inc. ("Northwind") and the counterparty identified below, effective as of the date of last signature.

## 1. Confidential Information

"Confidential Information" means any non-public information disclosed by one Party to the other, whether orally, in writing, or by inspection of tangible objects, that is designated as confidential or that a reasonable person would understand to be confidential given its nature and the circumstances of disclosure.

## 2. Obligations

Each Party will protect the other's Confidential Information using at least the degree of care it uses for its own information of like importance, and in no event less than reasonable care. Neither Party will disclose Confidential Information to any third party except to its employees and advisers who need to know it and are bound by obligations no less protective than these.

## 3. Term

This Agreement continues for two (2) years from the Effective Date. The obligations in Section 2 survive for three (3) years after expiry, and indefinitely for any Confidential Information that constitutes a trade secret.

## 4. Return of Materials

On written request, each Party will return or destroy the other's Confidential Information, except for copies retained in routine backups or as required by law.

## 5. Governing Law

This Agreement is governed by the laws of the State of Delaware, without regard to its conflict of laws principles.
`;

const ORDER_FORM = `# Order Form 2026-114

This Order Form is governed by the Master Services Agreement between Northwind Analytics, Inc. and the Client identified below.

## Services

Analytics Platform subscription, Standard support tier, and onboarding for up to fifty (50) Authorized Users.

## Subscription Term

Twelve (12) months from the Effective Date, renewing automatically for successive twelve (12) month terms unless either Party gives sixty (60) days' notice.

## Fees

An annual subscription fee of $84,000, invoiced yearly in advance and payable within thirty (30) days of invoice.

## Deliverables

- Platform tenant provisioning
- Onboarding workshops for administrators
- Quarterly business reviews

1. Kickoff within ten (10) days
2. Configuration sign-off
3. Production go-live

## Rate Card

| Role | Hourly rate | Notes |
| --- | --- | --- |
| Solution architect | $310 | Scoping and integrations |
| Data engineer | $245 | Pipelines |
| Trainer | $180 | Onboarding sessions |
`;

export function sampleFile(name: string, markdown: string): File {
  // The SDK reads the format from the extension; no MIME juggling needed.
  return new File([markdown], name, { type: "text/markdown" });
}

export const SAMPLE_DOCUMENTS = [
  { id: "nda", title: "Mutual NDA", file: () => sampleFile("Mutual NDA.md", NDA) },
  {
    id: "order-form",
    title: "Order Form 2026-114",
    file: () => sampleFile("Order Form 2026-114.md", ORDER_FORM),
  },
];
