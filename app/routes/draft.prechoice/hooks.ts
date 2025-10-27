import { useNavigate, useSubmit } from "@remix-run/react";
import type { DraftSettings, DiscordData } from "~/types";
import type { MiltyDraftSettings } from "~/components/MiltySettingsModal";
import type { MiltyEqDraftSettings } from "~/components/MiltyEqSettingsModal";
import { useDraftSetup } from "./store";
import { buildSliceGenerationConfig } from "./utils";

export const useDraftSettingsBuilder = (
  miltySettings: MiltyDraftSettings,
  miltyEqSettings: MiltyEqDraftSettings,
) => {
  const content = useDraftSetup((state) => state.content);
  const map = useDraftSetup((state) => state.map);
  const faction = useDraftSetup((state) => state.faction);
  const slices = useDraftSetup((state) => state.slices);
  const format = useDraftSetup((state) => state.format);

  const buildDraftSettings = (): DraftSettings => {
    const factionGameSets = content.getFactionGameSets();
    const tileGameSets = content.getTileGameSets();
    const hasMinorFactions = !!faction.minorFactionsMode;

    const draftSettings: DraftSettings = {
      factionGameSets,
      tileGameSets,
      type: map.selectedMapType,
      numFactions: faction.numFactions,
      randomizeMap: !faction.minorFactionsMode,
      numPreassignedFactions: faction.preassignedFactions,
      minorFactionsMode: faction.minorFactionsMode,
      numSlices: Number(slices.numSlices),
      randomizeSlices: true,
      draftSpeaker: format.draftSpeaker,
      allowHomePlanetSearch: format.allowHomePlanetSearch,
      allowEmptyTiles: format.allowEmptyTiles,
      draftPlayerColors: format.draftPlayerColors,
      modifiers: format.banFactions
        ? { banFactions: { numFactions: 1 } }
        : undefined,
      allowedFactions: faction.allowedFactions,
      requiredFactions: faction.requiredFactions,
      factionStratification: faction.stratifiedConfig,
    };

    const sliceConfig = buildSliceGenerationConfig(
      map.selectedMapType,
      miltySettings,
      miltyEqSettings,
      hasMinorFactions,
    );

    if (sliceConfig) {
      draftSettings.sliceGenerationConfig = sliceConfig;
    }

    if (faction.minorFactionsMode?.mode === "sharedPool") {
      draftSettings.minorFactionsInSharedPool = true;
    } else if (faction.minorFactionsMode?.mode === "separatePool") {
      draftSettings.numMinorFactions =
        faction.minorFactionsMode.numMinorFactions;
    }

    return draftSettings;
  };

  return { buildDraftSettings };
};

export const useDraftNavigation = (discordData?: DiscordData) => {
  const navigate = useNavigate();
  const submit = useSubmit();
  const player = useDraftSetup((state) => state.player);
  const multidraft = useDraftSetup((state) => state.multidraft);

  const navigateToDraft = (draftSettings: DraftSettings) => {
    if (multidraft.isMultidraft) {
      const formData = new FormData();
      formData.append("draftSettings", JSON.stringify(draftSettings));
      formData.append("players", JSON.stringify(player.players));
      formData.append(
        "discordData",
        discordData ? JSON.stringify(discordData) : "",
      );
      formData.append("numDrafts", multidraft.numDrafts.toString());

      submit(formData, {
        method: "post",
        action: "/multidraft",
      });
      return;
    }

    navigate("/draft/new", {
      state: {
        draftSettings,
        players: player.players,
        discordData,
      },
    });
  };

  return { navigateToDraft };
};
