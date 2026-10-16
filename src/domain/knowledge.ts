export type ArticleStatus = "draft" | "in_review" | "published" | "archived";
export type ArticleVisibility = "public" | "tenant" | "private";

export interface KnowledgeArticle {
  readonly id: string;
  readonly tenantId: string;
  readonly authorUserId: string;
  readonly status: ArticleStatus;
  readonly visibility: ArticleVisibility;
}

export interface KnowledgeAccessContext {
  readonly userId: string | null;
  readonly tenantId: string | null;
  readonly hasReadPermission: boolean;
  readonly hasManagePermission: boolean;
  readonly privateArticleIds: readonly string[];
}

const allowedTransitions: Readonly<Record<ArticleStatus, readonly ArticleStatus[]>> = {
  draft: ["in_review", "archived"],
  in_review: ["draft", "published", "archived"],
  published: ["in_review", "archived"],
  archived: ["draft"]
};

/** Returns whether an editorial state change is permitted. */
export function canTransitionArticle(
  currentStatus: ArticleStatus,
  nextStatus: ArticleStatus
): boolean {
  return allowedTransitions[currentStatus].includes(nextStatus);
}

/** Throws when a requested editorial state change is not permitted. */
export function assertArticleTransition(
  currentStatus: ArticleStatus,
  nextStatus: ArticleStatus
): void {
  if (!canTransitionArticle(currentStatus, nextStatus)) {
    throw new Error(`Cannot transition a ${currentStatus} article to ${nextStatus}.`);
  }
}

/**
 * Evaluates read access without exposing private articles through a tenant-wide
 * read permission. Database RLS remains the authoritative enforcement point.
 */
export function canReadArticle(
  article: KnowledgeArticle,
  context: KnowledgeAccessContext
): boolean {
  if (context.userId === null) {
    return false;
  }

  if (article.status !== "published" && article.authorUserId !== context.userId) {
    return context.hasManagePermission && context.tenantId === article.tenantId;
  }

  if (article.visibility === "public") {
    return article.status === "published" || article.authorUserId === context.userId;
  }

  if (context.tenantId !== article.tenantId) {
    return false;
  }

  if (article.visibility === "tenant") {
    return context.hasReadPermission || context.hasManagePermission || article.authorUserId === context.userId;
  }

  return (
    article.authorUserId === context.userId ||
    context.hasManagePermission ||
    context.privateArticleIds.includes(article.id)
  );
}
