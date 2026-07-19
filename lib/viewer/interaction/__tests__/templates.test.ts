import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES,
  templateById,
  templatesFor,
  toolKeyFor,
  type TemplateGroup,
} from "../templates.ts";

// Registry invariants. (The repo's other templates.test.ts covers the LEGACY
// MeasurePalette templates — a different module.)

test("template ids are unique", () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every P1 template defers its calc kind (defaultKind null) — panel calcType still wins", () => {
  for (const t of TEMPLATES) assert.equal(t.defaultKind, null, `${t.id} should defer kind in P1`);
});

test("probe templates carry no primitive; draw templates always do", () => {
  for (const t of TEMPLATES) {
    if (t.probe) assert.equal(t.primitive, null, `${t.id} is a probe → primitive null`);
    else assert.notEqual(t.primitive, null, `${t.id} is a draw template → primitive set`);
  }
});

test("toolKeyFor matches the legacy palette:* scheme for every template", () => {
  for (const t of TEMPLATES) assert.equal(toolKeyFor(t.id), `palette:${t.id}`);
});

test("templatesFor covers exactly the three toolbar groups, non-empty each", () => {
  const groups: TemplateGroup[] = ["point", "line", "polygon"];
  let total = 0;
  for (const g of groups) {
    const list = templatesFor(g);
    assert.ok(list.length >= 1, `group ${g} has templates`);
    for (const t of list) assert.equal(t.group, g);
    total += list.length;
  }
  assert.equal(total, TEMPLATES.length); // every template lives in exactly one group
});

test("templateById round-trips and returns undefined for unknown ids", () => {
  for (const t of TEMPLATES) assert.equal(templateById(t.id), t);
  // @ts-expect-error — exercising the not-found path with a non-TemplateId
  assert.equal(templateById("nope"), undefined);
});
