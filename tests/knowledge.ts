import assert from "node:assert/strict";
import test from "node:test";

import {
  assertArticleTransition,
  canReadArticle,
  type KnowledgeArticle
} from "../src/domain/knowledge";

const privateArticle: KnowledgeArticle = {
  id: "article-private",
  tenantId: "tenant-a",
  authorUserId: "author-a",
  status: "published",
  visibility: "private"
};

test("allows the editorial review and publication flow", () => {
  assert.doesNotThrow(() => assertArticleTransition("draft", "in_review"));
  assert.doesNotThrow(() => assertArticleTransition("in_review", "published"));
  assert.doesNotThrow(() => assertArticleTransition("published", "archived"));
  assert.doesNotThrow(() => assertArticleTransition("archived", "draft"));
});

test("rejects invalid editorial transitions", () => {
  assert.throws(() => assertArticleTransition("draft", "published"));
  assert.throws(() => assertArticleTransition("published", "draft"));
  assert.throws(() => assertArticleTransition("archived", "published"));
});

test("does not reveal a private article to an unrelated tenant reader", () => {
  assert.equal(
    canReadArticle(privateArticle, {
      userId: "reader-b",
      tenantId: "tenant-b",
      hasReadPermission: true,
      hasManagePermission: false,
      privateArticleIds: []
    }),
    false
  );
});

test("allows an explicitly granted reader to access a private article", () => {
  assert.equal(
    canReadArticle(privateArticle, {
      userId: "reader-a",
      tenantId: "tenant-a",
      hasReadPermission: true,
      hasManagePermission: false,
      privateArticleIds: [privateArticle.id]
    }),
    true
  );
});
