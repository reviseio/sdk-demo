import { productStrategyFile } from "./showcaseDocument";

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
  {
    id: "strategy-brief",
    title: "Product Strategy Brief",
    file: productStrategyFile,
  },
  {
    id: "order-form",
    title: "Order Form 2026-114",
    file: () => sampleFile("Order Form 2026-114.md", ORDER_FORM),
  },
];
