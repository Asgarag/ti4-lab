import { Box, ScrollArea, SegmentedControl, Stack, Tabs, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { useMapBuilder } from "~/mapBuilderStore";
import { getSystemGameSet, systemData } from "~/data/systemData";
import { systemsFromIds } from "~/utils/system";
import { DraggableSidebarTile } from "./DraggableSidebarTile";
import { MiniHex } from "./MiniHex";
import { MiniWormhole } from "./MiniWormhole";

type TileFilter = "all" | "blue" | "red" | "wormhole";

export function TileSidebar() {
  const systemPool = useMapBuilder((state) => state.state.systemPool);
  const gameSets = useMapBuilder((state) => state.state.gameSets);
  const systems = systemsFromIds(systemPool);
  const map = useMapBuilder((state) => state.state.map);
  const [filter, setFilter] = useState<TileFilter>("all");

  const usedSystemIds = new Set(
    map
      .filter((tile) => tile.type === "SYSTEM")
      .map((tile) => (tile.type === "SYSTEM" ? tile.systemId : null))
      .filter(Boolean),
  );

  const filterSystems = (systemList: typeof systems) => {
    if (filter === "all") return systemList;
    if (filter === "wormhole") {
      return systemList.filter((system) => system.wormholes.length > 0);
    }
    return systemList.filter((system) => system.type === filter.toUpperCase());
  };

  const availableSystems = filterSystems(
    systems.filter((system) => !usedSystemIds.has(system.id)),
  );
  const usedSystems = filterSystems(
    systems.filter((system) => usedSystemIds.has(system.id)),
  );

  const hyperlaneOptions = useMemo(() => {
    const enabledSets = new Set(
      gameSets.map((set) => {
        if (set === "unchartedstars") return "us";
        if (set === "discordant" || set === "discordantexp") return "ds";
        return set;
      }),
    );

    const rotations = [0, 60, 120, 180, 240, 300];

    return Object.values(systemData)
      .filter((system) => {
        if (system.type !== "HYPERLANE") return false;
        const systemSet = getSystemGameSet(system.id);
        if (!systemSet) return true;
        return enabledSets.has(systemSet);
      })
      .flatMap((system) =>
        rotations.map((rotation) => ({
          systemId: system.id,
          rotation,
        })),
      );
  }, [gameSets]);

  return (
    <Box h="calc(100vh - 60px)" bg="dark.7">
      <Tabs defaultValue="tiles" variant="outline" h="100%">
        <Tabs.List grow>
          <Tabs.Tab value="tiles">Tiles</Tabs.Tab>
          <Tabs.Tab value="hyperlanes">Hyperlanes</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="tiles">
          <Box px="sm" pt="xs" pb="xs">
            <Text
              size="xs"
              fw={600}
              tt="uppercase"
              c="dimmed"
              mb={6}
              style={{ letterSpacing: "0.05em", fontFamily: "Orbitron" }}
            >
              Tiles ({availableSystems.length})
            </Text>
            <SegmentedControl
              value={filter}
              onChange={(value) => setFilter(value as TileFilter)}
              size="xs"
              fullWidth
              data={[
                { value: "all", label: "All" },
                {
                  value: "blue",
                  label: (
                    <Box style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MiniHex color="#4dabf7" />
                    </Box>
                  ),
                },
                {
                  value: "red",
                  label: (
                    <Box style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MiniHex color="#ff6b6b" />
                    </Box>
                  ),
                },
                {
                  value: "wormhole",
                  label: (
                    <Box style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MiniWormhole />
                    </Box>
                  ),
                },
              ]}
            />
          </Box>

          <ScrollArea h="calc(100vh - 60px - 110px)" type="scroll">
            <Stack gap="xs" px="sm" pb="sm">
              {availableSystems.map((system) => (
                <DraggableSidebarTile key={system.id} systemId={system.id} />
              ))}
            </Stack>

            {usedSystems.length > 0 && (
              <>
                <Box
                  px="sm"
                  py={6}
                  bg="dark.6"
                  style={{ borderTop: "1px solid var(--mantine-color-dark-5)" }}
                >
                  <Text
                    size="xs"
                    fw={600}
                    tt="uppercase"
                    c="dimmed"
                    style={{ letterSpacing: "0.05em", fontFamily: "Orbitron" }}
                  >
                    Used ({usedSystems.length})
                  </Text>
                </Box>
                <Stack gap="xs" px="sm" py="sm">
                  {usedSystems.map((system) => (
                    <DraggableSidebarTile key={system.id} systemId={system.id} />
                  ))}
                </Stack>
              </>
            )}
          </ScrollArea>
        </Tabs.Panel>

        <Tabs.Panel value="hyperlanes">
          <Box px="sm" pt="xs" pb="xs">
            <Text
              size="xs"
              fw={600}
              tt="uppercase"
              c="dimmed"
              style={{ letterSpacing: "0.05em", fontFamily: "Orbitron" }}
            >
              Hyperlanes ({hyperlaneOptions.length})
            </Text>
          </Box>
          <ScrollArea h="calc(100vh - 60px - 86px)" type="scroll">
            <Stack gap="xs" px="sm" pb="sm">
              {hyperlaneOptions.map(({ systemId, rotation }) => (
                <DraggableSidebarTile
                  key={`${systemId}-${rotation}`}
                  systemId={systemId}
                  rotation={rotation}
                />
              ))}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
