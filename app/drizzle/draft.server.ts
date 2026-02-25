import { desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "./config.server";
import { drafts, draftStagedSelections } from "./schema.server";
import { generatePrettyUrlName } from "~/data/urlWords.server";
import { Draft, SimultaneousPickType } from "~/types";
import { enqueueImageJob } from "~/utils/imageJobQueue.server";
import { v4 as uuidv4 } from "uuid";

export async function draftById(id: string) {
  const results = await db
    .select()
    .from(drafts)
    .where(eq(drafts.id, id))
    .limit(1);

  return results[0];
}

function stripEphemeralDraftFields(draft: Draft): Draft {
  const persistable = { ...draft };
  delete (persistable as { stagedSelections?: Draft["stagedSelections"] })
    .stagedSelections;
  return persistable;
}

type SavedDraft = {
  id: string;
  data: Draft;
  urlName: string | null;
  type: string | null;
  isComplete: boolean | null;
  imageUrl: string | null;
  incompleteImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  mode: DraftMode;
  phase: DraftPhase;
  selectionsCount: number;
  pickOrderCount: number;
  progressPercent: number;
  playerCount: number;
  playerNames: string;
};

export type DraftMode = "base" | "twilightsFall" | "texasStyle" | "presetMap";
export type DraftPhase =
  | "ban"
  | "priorityValue"
  | "homeSystem"
  | "texasFaction"
  | "texasBlueKeep1"
  | "texasBlueKeep2"
  | "texasRedKeep"
  | "texasMapBuild"
  | "standardPick"
  | "complete";

export type DraftStats = {
  allDrafts: number;
  scopedDrafts: number;
  filteredDrafts: number;
  completedDrafts: number;
  completionPercent: number;
  draftsByType: Record<string, number>;
  draftsByMode: Record<string, number>;
  draftsByPhase: Record<string, number>;
};

function normalizeDraftType(type: string | null): string {
  if (!type) return "unknown";

  // Normalize milty variants (milty5p, milty6p, milty8p, etc. -> milty)
  if (type.startsWith("milty") && !type.startsWith("miltyeq")) {
    return "milty";
  }

  // Normalize miltyeq variants (miltyeq5p, miltyeq7p, miltyeq8p -> miltyeq)
  if (type.startsWith("miltyeq")) {
    return "miltyeq";
  }

  return type;
}

export type PaginatedDrafts = {
  drafts: SavedDraft[];
  totalPages: number;
  currentPage: number;
  filteredTotal: number;
  stats: DraftStats;
};

type FindDraftsParams = {
  page?: number;
  pageSize?: number;
  sortBy?:
    | "createdAt"
    | "updatedAt"
    | "type"
    | "isComplete"
    | "mode"
    | "phase"
    | "progress"
    | "players";
  sortOrder?: "asc" | "desc";
  typeFilter?: string;
  modeFilter?: DraftMode;
  phaseFilter?: DraftPhase;
  isCompleteFilter?: boolean;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
};

const draftModeExpr = sql<string>`coalesce(json_extract(${drafts.data}, '$.settings.draftGameMode'), 'base')`;
const selectionsCountExpr = sql<number>`coalesce(json_array_length(json_extract(${drafts.data}, '$.selections')), 0)`;
const pickOrderCountExpr = sql<number>`coalesce(json_array_length(json_extract(${drafts.data}, '$.pickOrder')), 0)`;
const playersCountExpr = sql<number>`coalesce(json_array_length(json_extract(${drafts.data}, '$.players')), 0)`;
const currentPickExpr = sql`json_extract(${drafts.data}, '$.pickOrder[' || ${selectionsCountExpr} || ']')`;
const currentPickTypeExpr = sql<string>`json_type(${currentPickExpr})`;
const currentPhaseExpr = sql<string>`json_extract(${drafts.data}, '$.pickOrder[' || ${selectionsCountExpr} || '].phase')`;
const banPerPlayerExpr = sql<number>`coalesce(json_extract(${drafts.data}, '$.settings.modifiers.banFactions.numFactions'), 0)`;
const banNeededExpr = sql<number>`${banPerPlayerExpr} * ${playersCountExpr}`;
const progressPercentExpr = sql<number>`
  case
    when ${pickOrderCountExpr} > 0 then (100.0 * ${selectionsCountExpr} / ${pickOrderCountExpr})
    else 0
  end
`;
const draftPhaseExpr = sql<string>`
  case
    when ${drafts.isComplete} = 1 then 'complete'
    when ${banPerPlayerExpr} > 0 and ${selectionsCountExpr} < ${banNeededExpr} then 'ban'
    when ${currentPickTypeExpr} = 'object' then coalesce(${currentPhaseExpr}, 'standardPick')
    when ${draftModeExpr} = 'texasStyle' then 'texasMapBuild'
    else 'standardPick'
  end
`;

function buildTypeFilterCondition(typeFilter: string): SQL {
  if (typeFilter === "milty") {
    return sql`${drafts.type} like ${"milty%"} and ${drafts.type} not like ${"miltyeq%"}`;
  }
  if (typeFilter === "miltyeq") {
    return sql`${drafts.type} like ${"miltyeq%"}`;
  }
  if (typeFilter === "unknown") {
    return sql`${drafts.type} is null`;
  }

  return eq(drafts.type, typeFilter);
}

function deriveDraftMode(draft: Draft): DraftMode {
  return draft.settings.draftGameMode ?? "base";
}

function deriveDraftPhase(draft: Draft, isComplete: boolean): DraftPhase {
  if (isComplete) return "complete";

  const currentPickNumber = draft.selections?.length ?? 0;
  const banModifier = draft.settings.modifiers?.banFactions;
  const totalBansNeeded = (banModifier?.numFactions ?? 0) * draft.players.length;
  if (banModifier && currentPickNumber < totalBansNeeded) return "ban";

  const currentPick = draft.pickOrder?.[currentPickNumber];
  if (typeof currentPick === "object" && currentPick?.kind === "simultaneous") {
    return currentPick.phase;
  }

  if (deriveDraftMode(draft) === "texasStyle") return "texasMapBuild";
  return "standardPick";
}

export async function findDrafts({
  page = 1,
  pageSize = 100,
  sortBy = "createdAt",
  sortOrder = "desc",
  typeFilter,
  modeFilter,
  phaseFilter,
  isCompleteFilter,
  search,
  createdAfter,
  createdBefore,
  updatedAfter,
  updatedBefore,
}: FindDraftsParams = {}): Promise<PaginatedDrafts> {
  const offset = (page - 1) * pageSize;
  const scopedConditions: SQL[] = [];
  const allConditions: SQL[] = [];

  if (typeFilter) {
    scopedConditions.push(buildTypeFilterCondition(typeFilter));
  }
  if (modeFilter) {
    scopedConditions.push(sql`${draftModeExpr} = ${modeFilter}`);
  }
  if (search?.trim()) {
    const searchLike = `%${search.trim().toLowerCase()}%`;
    scopedConditions.push(
      sql`(
        lower(${drafts.id}) like ${searchLike}
        or lower(coalesce(${drafts.urlName}, '')) like ${searchLike}
        or lower(cast(${drafts.data} as text)) like ${searchLike}
      )`,
    );
  }
  if (createdAfter) {
    scopedConditions.push(sql`${drafts.createdAt} >= ${createdAfter}`);
  }
  if (createdBefore) {
    scopedConditions.push(sql`${drafts.createdAt} <= ${createdBefore}`);
  }
  if (updatedAfter) {
    scopedConditions.push(sql`${drafts.updatedAt} >= ${updatedAfter}`);
  }
  if (updatedBefore) {
    scopedConditions.push(sql`${drafts.updatedAt} <= ${updatedBefore}`);
  }

  allConditions.push(...scopedConditions);
  if (isCompleteFilter !== undefined) {
    allConditions.push(eq(drafts.isComplete, isCompleteFilter));
  }
  if (phaseFilter) {
    allConditions.push(sql`${draftPhaseExpr} = ${phaseFilter}`);
  }

  const orderColumn =
    sortBy === "createdAt"
      ? drafts.createdAt
      : sortBy === "updatedAt"
        ? drafts.updatedAt
        : sortBy === "type"
          ? drafts.type
          : sortBy === "mode"
            ? draftModeExpr
            : sortBy === "phase"
              ? draftPhaseExpr
              : sortBy === "progress"
                ? progressPercentExpr
                : sortBy === "players"
                  ? playersCountExpr
                  : drafts.isComplete;

  const orderFn = sortOrder === "asc" ? sql`${orderColumn} ASC` : desc(orderColumn);
  let query = db.select().from(drafts);
  if (allConditions.length > 0) {
    query = query.where(sql`${sql.join(allConditions, sql` AND `)}`) as typeof query;
  }

  const resultsWhere =
    allConditions.length > 0
      ? sql`${sql.join(allConditions, sql` AND `)}`
      : sql`1=1`;
  const scopeWhere =
    scopedConditions.length > 0
      ? sql`${sql.join(scopedConditions, sql` AND `)}`
      : sql`1=1`;

  const [
    draftsData,
    filteredCount,
    scopedCount,
    allCount,
    completedCount,
    typeStats,
    modeStats,
    phaseStats,
  ] = await Promise.all([
    query.orderBy(orderFn).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(drafts).where(resultsWhere),
    db.select({ count: sql<number>`count(*)` }).from(drafts).where(scopeWhere),
    db.select({ count: sql<number>`count(*)` }).from(drafts),
    db
      .select({ count: sql<number>`count(*)` })
      .from(drafts)
      .where(sql`${scopeWhere} AND ${drafts.isComplete} = 1`),
    db
      .select({
        type: drafts.type,
        count: sql<number>`count(*)`,
      })
      .from(drafts)
      .where(scopeWhere)
      .groupBy(drafts.type),
    db
      .select({
        mode: draftModeExpr,
        count: sql<number>`count(*)`,
      })
      .from(drafts)
      .where(scopeWhere)
      .groupBy(draftModeExpr),
    db
      .select({
        phase: draftPhaseExpr,
        count: sql<number>`count(*)`,
      })
      .from(drafts)
      .where(scopeWhere)
      .groupBy(draftPhaseExpr),
  ]);

  const data = draftsData.map((draft) => ({
    ...(() => {
      const parsedDraft = JSON.parse(draft.data as string) as Draft;
      const selectionsCount = parsedDraft.selections?.length ?? 0;
      const pickOrderCount = parsedDraft.pickOrder?.length ?? 0;
      const isComplete = !!draft.isComplete;
      const mode = deriveDraftMode(parsedDraft);
      const phase = deriveDraftPhase(parsedDraft, isComplete);

      return {
        ...draft,
        data: parsedDraft,
        mode,
        phase,
        selectionsCount,
        pickOrderCount,
        progressPercent:
          pickOrderCount > 0 ? (100 * selectionsCount) / pickOrderCount : 0,
        playerCount: parsedDraft.players?.length ?? 0,
        playerNames: parsedDraft.players?.map((p) => p.name).join(", ") ?? "",
      };
    })(),
  }));

  const totalPages = Math.ceil(filteredCount[0].count / pageSize);
  const scopedDrafts = scopedCount[0].count;
  const allDrafts = allCount[0].count;
  const filteredDrafts = filteredCount[0].count;
  const completedDrafts = completedCount[0].count;

  const draftsByType: Record<string, number> = {};
  typeStats.forEach((stat) => {
    const normalizedType = normalizeDraftType(stat.type);
    draftsByType[normalizedType] = (draftsByType[normalizedType] || 0) + stat.count;
  });

  const draftsByMode: Record<string, number> = {};
  modeStats.forEach((stat) => {
    const mode = stat.mode || "base";
    draftsByMode[mode] = (draftsByMode[mode] || 0) + stat.count;
  });

  const draftsByPhase: Record<string, number> = {};
  phaseStats.forEach((stat) => {
    const phase = stat.phase || "standardPick";
    draftsByPhase[phase] = (draftsByPhase[phase] || 0) + stat.count;
  });

  return {
    drafts: data,
    totalPages,
    currentPage: page,
    filteredTotal: filteredDrafts,
    stats: {
      allDrafts,
      scopedDrafts,
      filteredDrafts,
      completedDrafts,
      completionPercent:
        scopedDrafts > 0 ? (completedDrafts / scopedDrafts) * 100 : 0,
      draftsByType,
      draftsByMode,
      draftsByPhase,
    },
  };
}

export async function draftByPrettyUrl(urlName: string) {
  const results = await db
    .select()
    .from(drafts)
    .where(eq(drafts.urlName, urlName))
    .limit(1);

  return results[0];
}

export async function generateUniquePrettyUrl() {
  let exists = true;
  let prettyUrl = "";
  while (exists) {
    prettyUrl = generatePrettyUrlName();
    const existingRecord = await draftByPrettyUrl(prettyUrl);
    exists = !!existingRecord;
  }
  return prettyUrl;
}

export async function createDraft(draft: Draft, presetUrl?: string) {
  const id = uuidv4().toString();
  const prettyUrl = await getPrettyUrl(presetUrl);
  const type = draft.settings?.type || null;
  const isComplete =
    draft.selections?.length === draft.pickOrder?.length;

  db.insert(drafts)
    .values({
      id,
      urlName: prettyUrl,
      data: JSON.stringify(stripEphemeralDraftFields(draft)),
      type,
      isComplete,
    })
    .run();

  // Enqueue incomplete image generation
  enqueueImageJob(id, prettyUrl, false);

  return { id, prettyUrl };
}

async function getPrettyUrl(presetUrl?: string): Promise<string> {
  if (!presetUrl) return generateUniquePrettyUrl();

  // if the presetUrl is already taken, generate a new one
  // and update the old draft with the new url.
  const existingRecord = await draftByPrettyUrl(presetUrl);
  if (existingRecord) {
    const newUrl = await generateUniquePrettyUrl();
    await updateDraftUrl(existingRecord.id, newUrl);
  }

  return presetUrl;
}

export async function updateDraftUrl(id: string, urlName: string) {
  db.update(drafts)
    .set({ urlName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(drafts.id, id))
    .run();
}

export async function updateDraft(id: string, draftData: Draft) {
  const type = draftData.settings?.type || null;
  const newIsComplete =
    draftData.selections?.length === draftData.pickOrder?.length;

  // Get old completion status
  const existingDraft = await draftById(id);
  const oldIsComplete = existingDraft.isComplete;

  db.update(drafts)
    .set({
      data: JSON.stringify(stripEphemeralDraftFields(draftData)),
      type,
      isComplete: newIsComplete,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(drafts.id, id))
    .run();

  // If draft just became complete, enqueue complete image generation
  if (!oldIsComplete && newIsComplete && existingDraft.urlName) {
    enqueueImageJob(id, existingDraft.urlName, true);
  }
}

export async function upsertStagedSelection(
  draftId: string,
  phase: SimultaneousPickType,
  playerId: number,
  value: string,
) {
  await db
    .insert(draftStagedSelections)
    .values({
      id: uuidv4().toString(),
      draftId,
      phase,
      playerId,
      value,
    })
    .onConflictDoUpdate({
      target: [
        draftStagedSelections.draftId,
        draftStagedSelections.phase,
        draftStagedSelections.playerId,
      ],
      set: { value },
    })
    .run();
}

export async function getStagedSelections(
  draftId: string,
  phase: SimultaneousPickType,
): Promise<Record<number, string>> {
  const result = await db
    .select({
      playerId: draftStagedSelections.playerId,
      value: draftStagedSelections.value,
    })
    .from(draftStagedSelections)
    .where(
      sql`${draftStagedSelections.draftId} = ${draftId} AND ${draftStagedSelections.phase} = ${phase}`,
    );

  return result.reduce<Record<number, string>>((acc, row) => {
    acc[row.playerId] = row.value;
    return acc;
  }, {});
}

export async function deleteStagedSelection(
  draftId: string,
  phase: SimultaneousPickType,
  playerId: number,
) {
  await db
    .delete(draftStagedSelections)
    .where(
      sql`${draftStagedSelections.draftId} = ${draftId} AND ${draftStagedSelections.phase} = ${phase} AND ${draftStagedSelections.playerId} = ${playerId}`,
    )
    .run();
}

export async function clearStagedSelections(
  draftId: string,
  phase: SimultaneousPickType,
) {
  await db
    .delete(draftStagedSelections)
    .where(
      sql`${draftStagedSelections.draftId} = ${draftId} AND ${draftStagedSelections.phase} = ${phase}`,
    )
    .run();
}

export async function getDraftStagedSelections(
  draftId: string,
): Promise<Partial<Record<SimultaneousPickType, Record<number, string>>>> {
  const result = await db
    .select({
      phase: draftStagedSelections.phase,
      playerId: draftStagedSelections.playerId,
      value: draftStagedSelections.value,
    })
    .from(draftStagedSelections)
    .where(eq(draftStagedSelections.draftId, draftId));

  return result.reduce<
    Partial<Record<SimultaneousPickType, Record<number, string>>>
  >((acc, row) => {
    const phase = row.phase as SimultaneousPickType;
    if (!acc[phase]) acc[phase] = {};
    acc[phase]![row.playerId] = row.value;
    return acc;
  }, {});
}
