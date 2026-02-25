import { eq, and, gte, lt } from "drizzle-orm";
import { db } from "~/drizzle/config.server";
import { findDrafts } from "~/drizzle/draft.server";
import { drafts } from "~/drizzle/schema.server";
import { Draft, DraftPick } from "~/types";

async function migrateState() {
  let deletedCount = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await findDrafts({ page, pageSize: 100 });

    for (const draft of result.drafts) {
      // Delete drafts with miltyeqless or wekker draft types (legacy types no longer in DraftType union)
      const draftType = draft.data.settings.type as string;
      if (draftType === "miltyeqless" || draftType === "wekker") {
        await db.delete(drafts).where(eq(drafts.id, draft.id));
        deletedCount++;
        console.log(`Deleted draft ${draft.id} with type ${draft.data.settings.type}`);
      }
    }

    hasMore = page < result.totalPages;
    page++;
  }

  console.log(`Deleted ${deletedCount} drafts total`);
}

/**
 * Fixes twilightsFall drafts from Jan 21-23, 2026 that have an extra round
 * of picks in their pickOrder due to a bug that was running in production.
 *
 * The bug caused 4 rounds of sequential picks instead of 3.
 * This migration removes one round (numPlayers picks) from the end of the
 * sequential portion, before the simultaneous phases.
 *
 * Skips:
 * - Drafts of type "heisen"
 * - Completed drafts (where selections have reached the simultaneous phases)
 */
async function fixTwilightsFallPickOrder() {
  console.log("Starting twilightsFall pickOrder fix migration...");

  // Query drafts in the affected date range
  const affectedDrafts = await db
    .select()
    .from(drafts)
    .where(
      and(
        gte(drafts.createdAt, "2026-01-21 00:00:00"),
        lt(drafts.createdAt, "2026-01-23 00:00:00")
      )
    );

  let fixedCount = 0;
  let skippedCount = 0;

  console.log(`Found ${affectedDrafts.length} drafts in date range`);

  for (const draft of affectedDrafts) {
    // Data is stored as a blob/string, need to parse it
    const data =
      typeof draft.data === "string"
        ? (JSON.parse(draft.data) as Draft)
        : (draft.data as Draft);

    // Skip non-twilightsFall drafts
    if (data.settings?.draftGameMode !== "twilightsFall") {
      continue;
    }

    console.log(`Processing twilightsFall draft: ${draft.urlName}`);

    // Skip heisen type drafts
    if (data.settings.type === "heisen") {
      console.log(`Skipping heisen draft: ${draft.urlName}`);
      skippedCount++;
      continue;
    }

    const numPlayers = data.players.length;
    const pickOrder = data.pickOrder;

    // Count sequential picks (numbers, not simultaneous phases)
    const sequentialPicks = pickOrder.filter(
      (pick): pick is number => typeof pick === "number"
    );
    const simultaneousPhases = pickOrder.filter(
      (
        pick,
      ): pick is Extract<DraftPick, { kind: "simultaneous" }> =>
        typeof pick === "object" && pick.kind === "simultaneous"
    );

    // Check if this draft has 4 rounds instead of 3
    const expectedRounds = 3;
    const actualRounds = sequentialPicks.length / numPlayers;

    if (actualRounds !== 4) {
      // Not affected by the bug
      continue;
    }

    // Check if draft is completed (selections have reached simultaneous phases)
    // A draft is "complete" for our purposes if selections >= numPlayers * 3
    // (meaning all sequential picks are done)
    const correctSequentialPickCount = numPlayers * expectedRounds;
    if (data.selections.length >= correctSequentialPickCount) {
      // Check if any simultaneous phase selections exist
      const hasSimultaneousSelections = data.selections.some(
        (s) =>
          s.type === "COMMIT_SIMULTANEOUS" ||
          s.type === "COMMIT_PRIORITY_VALUES" ||
          s.type === "COMMIT_HOME_SYSTEMS"
      );

      if (hasSimultaneousSelections) {
        console.log(`Skipping completed draft: ${draft.urlName}`);
        skippedCount++;
        continue;
      }
    }

    // Fix the pickOrder by removing one round from the end of sequential picks
    // The structure is: [sequential picks..., simultaneous phases...]
    // We need to remove `numPlayers` picks from the end of sequential portion

    const fixedPickOrder: DraftPick[] = [
      ...sequentialPicks.slice(0, correctSequentialPickCount),
      ...simultaneousPhases,
    ];

    // Update the draft
    const updatedData: Draft = {
      ...data,
      pickOrder: fixedPickOrder,
    };

    await db
      .update(drafts)
      .set({ data: JSON.stringify(updatedData) })
      .where(eq(drafts.id, draft.id));

    console.log(
      `Fixed draft ${draft.urlName}: ${sequentialPicks.length} -> ${correctSequentialPickCount} sequential picks`
    );
    fixedCount++;
  }

  console.log(`\nMigration complete:`);
  console.log(`  Fixed: ${fixedCount} drafts`);
  console.log(`  Skipped: ${skippedCount} drafts`);
}

(async () => {
  // await migrateState();
  await fixTwilightsFallPickOrder();
  console.log("done");
})();
