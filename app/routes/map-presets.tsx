import {
  ActionIcon,
  Box,
  Button,
  Group,
  Text,
} from "@mantine/core";
import { Link, useLoaderData } from "react-router";
import { listPresetMaps, TechSkipsData } from "~/drizzle/presetMap.server";
import classes from "./map-presets/styles.module.css";
import {
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconHeart,
  IconHeartFilled,
  IconMap,
  IconSparkles,
} from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { MainAppShell } from "~/components/MainAppShell";
import { TechIcon } from "~/components/icons/TechIcon";
import { LegendaryIcon } from "~/components/icons/LegendaryIcon";
import { TechSpecialty } from "~/types";
import type { PresetMapRecord } from "~/drizzle/presetMap.server";

function TechSkipIcon({
  techSpecialty,
  count,
}: {
  techSpecialty: TechSpecialty;
  count: number;
}) {
  if (count === 0) return null;
  return (
    <Box pos="relative" style={{ display: "inline-flex", alignItems: "center" }}>
      <TechIcon techSpecialty={techSpecialty} size={18} />
      <Text
        size="xs"
        fw="bold"
        c="white"
        pos="absolute"
        style={{
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          WebkitTextStroke: "1.5px black",
          paintOrder: "stroke fill",
          fontSize: "0.6rem",
        }}
      >
        {count}
      </Text>
    </Box>
  );
}

function TechSkipsDisplay({ techSkips }: { techSkips: string | null }) {
  if (!techSkips) return null;

  try {
    const data = JSON.parse(techSkips) as TechSkipsData;
    const hasAny = data.G > 0 || data.R > 0 || data.B > 0 || data.Y > 0;
    if (!hasAny) return null;

    return (
      <Group gap={3}>
        <TechSkipIcon techSpecialty="BIOTIC" count={data.G} />
        <TechSkipIcon techSpecialty="WARFARE" count={data.R} />
        <TechSkipIcon techSpecialty="PROPULSION" count={data.B} />
        <TechSkipIcon techSpecialty="CYBERNETIC" count={data.Y} />
      </Group>
    );
  } catch {
    return null;
  }
}

function LegendaryDisplay({ count }: { count: number | null }) {
  if (!count || count === 0) return null;
  return (
    <Box pos="relative" style={{ display: "inline-flex", alignItems: "center" }}>
      <LegendaryIcon size={18} />
      <Text
        size="xs"
        fw="bold"
        c="white"
        pos="absolute"
        style={{
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          WebkitTextStroke: "1.5px black",
          paintOrder: "stroke fill",
          fontSize: "0.6rem",
        }}
      >
        {count}
      </Text>
    </Box>
  );
}

type AuthorGroup = {
  author: string;
  totalViews: number;
  totalLikes: number;
  maps: PresetMapRecord[];
};

function groupByAuthor(presets: PresetMapRecord[]): AuthorGroup[] {
  const grouped = new Map<string, PresetMapRecord[]>();

  for (const preset of presets) {
    const existing = grouped.get(preset.author);
    if (existing) {
      existing.push(preset);
    } else {
      grouped.set(preset.author, [preset]);
    }
  }

  const authors: AuthorGroup[] = [];
  for (const [author, maps] of grouped) {
    // Maps are already sorted by views desc from the server query
    const totalViews = maps.reduce((sum, m) => sum + (m.views ?? 0), 0);
    const totalLikes = maps.reduce((sum, m) => sum + (m.likes ?? 0), 0);
    authors.push({ author, totalViews, totalLikes, maps });
  }

  // Sort authors by total views descending (most popular first)
  authors.sort((a, b) => b.totalViews - a.totalViews);
  return authors;
}

function AuthorCarousel({
  group,
  statsById,
  onLike,
}: {
  group: AuthorGroup;
  statsById: Record<string, { likes: number; views: number; liked: boolean }>;
  onLike: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scroll = useCallback(
    (direction: "left" | "right") => {
      const el = scrollRef.current;
      if (!el) return;
      const cardWidth = 300;
      const gap = 16;
      const scrollAmount = (cardWidth + gap) * 2;
      el.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      // Update state after scroll animation
      setTimeout(updateScrollState, 350);
    },
    [updateScrollState],
  );

  return (
    <div className={classes.authorSection}>
      <div className={classes.authorHeader}>
        <div className={classes.authorInfo}>
          <div className={classes.authorAvatar}>
            {group.author.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className={classes.authorName}>{group.author}</div>
            <div className={classes.authorMeta}>
              {group.maps.length} map{group.maps.length !== 1 ? "s" : ""}
              <span className={classes.metaDot} />
              {group.totalViews.toLocaleString()} view
              {group.totalViews !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <div className={classes.chevronGroup}>
          <button
            className={classes.chevronButton}
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            aria-label="Scroll left"
          >
            <IconChevronLeft size={18} />
          </button>
          <button
            className={classes.chevronButton}
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            aria-label="Scroll right"
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        className={classes.carousel}
        ref={scrollRef}
        onScroll={updateScrollState}
      >
        {group.maps.map((preset) => {
          const stats = statsById[preset.id];
          return (
            <Link
              key={preset.id}
              to={`/maps/${preset.slug}`}
              className={classes.cardLink}
            >
              <div className={classes.card}>
                <div className={classes.mapPreviewWrap}>
                  <Box
                    component="img"
                    src={`/map-preset/${preset.id}.png`}
                    alt={preset.name}
                    className={classes.mapPreview}
                  />
                </div>
                <div className={classes.cardContent}>
                  <div className={classes.name}>{preset.name}</div>
                  <div className={classes.mapStats}>
                    {preset.avgSliceValue != null && (
                      <span className={classes.stat}>
                        <span className={classes.statValue}>
                          {preset.avgSliceValue}
                        </span>
                        <span className={classes.statLabel}>Avg</span>
                      </span>
                    )}
                    {preset.totalResources != null &&
                      preset.totalInfluence != null && (
                        <span className={classes.stat}>
                          <span className={classes.statValue}>
                            {preset.totalResources}/{preset.totalInfluence}
                          </span>
                          <span className={classes.statLabel}>R/I</span>
                        </span>
                      )}
                    <LegendaryDisplay count={preset.legendaries} />
                    <TechSkipsDisplay techSkips={preset.techSkips} />
                  </div>
                  {preset.description && (
                    <div className={classes.description}>
                      {preset.description}
                    </div>
                  )}
                </div>
                <div className={classes.statsRow}>
                  <Group gap="xs" className={classes.statGroup}>
                    <IconEye size={14} />
                    <Text size="xs">{stats?.views ?? preset.views ?? 0}</Text>
                  </Group>
                  <Group gap={6} className={classes.statGroup}>
                    <ActionIcon
                      variant="subtle"
                      color={stats?.liked ? "red" : "gray"}
                      size="xs"
                      className={classes.heartButton}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onLike(preset.id);
                      }}
                    >
                      {stats?.liked ? (
                        <IconHeartFilled size={14} />
                      ) : (
                        <IconHeart size={14} />
                      )}
                    </ActionIcon>
                    <Text size="xs">{stats?.likes ?? preset.likes ?? 0}</Text>
                  </Group>
                  <Button
                    component="a"
                    href={`/map-generator?map=${encodeURIComponent(
                      preset.mapString,
                    )}`}
                    variant="subtle"
                    color="blue"
                    size="compact-xs"
                    leftSection={<IconSparkles size={11} />}
                    className={classes.genButton}
                    onClick={(event) => event.stopPropagation()}
                  >
                    Generator
                  </Button>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export const loader = async () => {
  const presets = await listPresetMaps();
  return { presets };
};

export default function MapPresets() {
  const { presets } = useLoaderData<typeof loader>();
  const [statsById, setStatsById] = useState<
    Record<string, { likes: number; views: number; liked: boolean }>
  >(() =>
    Object.fromEntries(
      presets.map((preset) => [
        preset.id,
        {
          likes: preset.likes ?? 0,
          views: preset.views ?? 0,
          liked: false,
        },
      ]),
    ),
  );

  const totalMaps = presets.length;
  const authorGroups = useMemo(() => groupByAuthor(presets), [presets]);

  const handleLike = async (id: string) => {
    const response = await fetch(`/api/preset-maps/${id}/like`, {
      method: "POST",
    });
    const result = await response.json().catch(() => null);
    if (!result?.success) return;

    setStatsById((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { likes: 0, views: 0, liked: false }),
        likes: result.likes ?? prev[id]?.likes ?? 0,
        liked: result.liked ?? prev[id]?.liked ?? false,
      },
    }));
  };

  return (
    <MainAppShell>
      <Box className={classes.page}>
        <div className={classes.header}>
          <div className={classes.headerRow}>
            <h1 className={classes.title}>Published Maps</h1>
            <span className={classes.badge}>
              <IconMap size={12} />
              {totalMaps}
            </span>
          </div>
          <p className={classes.subtitle}>
            Browse community-created preset maps, grouped by author. Most
            popular first.
          </p>
        </div>

        <div className={classes.authorList}>
          {authorGroups.map((group) => (
            <AuthorCarousel
              key={group.author}
              group={group}
              statsById={statsById}
              onLike={handleLike}
            />
          ))}
        </div>
      </Box>
    </MainAppShell>
  );
}
