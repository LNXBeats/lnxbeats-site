import assert from "node:assert/strict";
import test from "node:test";

import { AdminPrivateDocumentHeading } from "@/components/admin-private-document-heading";

type ElementNode = Readonly<{
  type: unknown;
  props: Readonly<Record<string, unknown> & { children?: unknown }>;
}>;

function node(value: unknown): ElementNode {
  assert.ok(value && typeof value === "object" && "type" in value && "props" in value);
  return value as ElementNode;
}

function heading(contractNumber: string, documentVersion: number, kind: "PREAUTHORIZATION" | "CONTRACT", isLatest: boolean) {
  return node(AdminPrivateDocumentHeading({ contractNumber, documentVersion, kind, isLatest }));
}

function assertSeparatedLatestHeading(element: ElementNode, versionLabel: string, badgeLabel: string) {
  assert.equal(element.type, "div");
  assert.equal(element.props.className, "admin-private-document__heading");
  assert.equal(element.props["aria-label"], `${versionLabel}. ${badgeLabel}.`);
  assert.doesNotMatch(String(element.props["aria-label"]), /C02Dernier|P02Dernière/);

  const children = element.props.children as readonly unknown[];
  const versionBlock = node(children[0]);
  const badge = node(children[1]);
  assert.equal(versionBlock.type, "p");
  assert.equal(versionBlock.props.className, "admin-private-document__version");
  assert.equal(node(versionBlock.props.children).props.children, versionLabel);
  assert.equal(badge.type, "span");
  assert.equal(badge.props.className, "admin-private-document__badge");
  assert.equal(badge.props.children, badgeLabel);
}

test("the actual Admin document heading separates the latest contract badge", () => {
  assertSeparatedLatestHeading(
    heading("LNX-PART-2026-000020-C02", 2, "CONTRACT", true),
    "Version 2 — C02",
    "Dernier projet de contrat",
  );
});

test("the actual Admin document heading separates the latest preauthorization badge", () => {
  assertSeparatedLatestHeading(
    heading("LNX-PART-2026-000020-P02", 2, "PREAUTHORIZATION", true),
    "Version 2 — P02",
    "Dernière préautorisation",
  );
});

test("non-latest C01 and P01 headings expose no latest badge", () => {
  for (const element of [
    heading("LNX-PART-2026-000020-C01", 1, "CONTRACT", false),
    heading("LNX-PART-2026-000020-P01", 1, "PREAUTHORIZATION", false),
  ]) {
    const children = element.props.children as readonly unknown[];
    assert.equal(children[1], null);
    assert.doesNotMatch(String(element.props["aria-label"]), /Dernier|Dernière/);
  }
});
