import { eq, and, asc, lt, isNotNull } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { foundPosts } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import { PostStatus, type AccountCategory } from '../database/types.js';

export async function savePost(
  postLink: string,
  keyword: string,
  category: AccountCategory,
): Promise<{ created: boolean }> {
  const [existing] = await getDb()
    .select({ id: foundPosts.id })
    .from(foundPosts)
    .where(eq(foundPosts.postLink, postLink))
    .limit(1);

  if (existing) return { created: false };

  await getDb().insert(foundPosts).values({
    id: newId(),
    postLink,
    keyword,
    category,
    status: PostStatus.PENDING,
  });

  return { created: true };
}

export async function lockPostForProcessing(
  postId: string,
  accountId: string,
): Promise<boolean> {
  try {
    await getDb().transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(foundPosts)
        .where(eq(foundPosts.id, postId))
        .limit(1);

      if (!post || post.status !== PostStatus.PENDING) {
        throw new Error('Post not available');
      }

      await tx
        .update(foundPosts)
        .set({
          status: PostStatus.PROCESSING,
          processingById: accountId,
          lockedAt: new Date(),
        })
        .where(eq(foundPosts.id, postId));
    });
    return true;
  } catch {
    return false;
  }
}

export async function markPostSuccess(
  postId: string,
  accountId: string,
  templateText: string,
) {
  await getDb()
    .update(foundPosts)
    .set({
      status: PostStatus.SUCCESS,
      senderAccountId: accountId,
      sentTemplateText: templateText,
      sentAt: new Date(),
      errorText: null,
      processingById: null,
      lockedAt: null,
    })
    .where(eq(foundPosts.id, postId));
}

export async function markPostPending(postId: string, retryCount: number) {
  await getDb()
    .update(foundPosts)
    .set({
      status: PostStatus.PENDING,
      retryCount,
      processingById: null,
      lockedAt: null,
    })
    .where(eq(foundPosts.id, postId));
}

export async function markPostError(
  postId: string,
  errorText: string,
  retryCount: number,
) {
  await getDb()
    .update(foundPosts)
    .set({
      status: PostStatus.ERROR,
      errorText,
      retryCount,
      processingById: null,
      lockedAt: null,
    })
    .where(eq(foundPosts.id, postId));
}

export async function getPendingPostsForCategory(
  category: AccountCategory,
  limit = 10,
) {
  return getDb()
    .select()
    .from(foundPosts)
    .where(and(eq(foundPosts.category, category), eq(foundPosts.status, PostStatus.PENDING)))
    .orderBy(asc(foundPosts.detectedAt))
    .limit(limit);
}

export async function unlockStalePosts(staleMinutes = 10) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  await getDb()
    .update(foundPosts)
    .set({
      status: PostStatus.PENDING,
      processingById: null,
      lockedAt: null,
    })
    .where(
      and(
        eq(foundPosts.status, PostStatus.PROCESSING),
        isNotNull(foundPosts.lockedAt),
        lt(foundPosts.lockedAt, cutoff),
      ),
    );
}

export async function getFoundPostById(postId: string) {
  const [post] = await getDb()
    .select()
    .from(foundPosts)
    .where(eq(foundPosts.id, postId))
    .limit(1);
  return post ?? null;
}
