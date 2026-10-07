import type React from "react";
import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router-dom";
import CollectionsIcon from "@mui/icons-material/Collections";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import PersonIcon from "@mui/icons-material/Person";
import FolderIcon from "@mui/icons-material/Folder";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import { dashboardApi, type DashboardSummary } from "../../api/dashboard";
import type { DashboardWidgetChoices, DashboardWidgetId } from "../../api/settings";
import CountCard from "./CountCard";
import ModelListCard from "./ModelListCard";
import AuthorListCard from "./AuthorListCard";
import ProviderListCard from "./ProviderListCard";
import RecentlyAddedCard from "./RecentlyAddedCard";

type WidgetContext = { summary: DashboardSummary; t: TFunction; navigate: NavigateFunction };

export type DashboardWidget = {
  id: DashboardWidgetId;
  /** The widget's name in the settings dialog. */
  labelKey: string;
  /** Which of the three columns it sits in on a wide screen. */
  column: 0 | 1 | 2;
  /** Shown until the user switches it off. An optional widget can start hidden instead. */
  defaultEnabled: boolean;
  render: (ctx: WidgetContext) => React.ReactNode;
};

/** In page order. A new widget is one entry here, plus its id in DashboardWidgetId and the backend. */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  {
    id: "collectionCount",
    labelKey: "dashboard.collectionCount.label",
    column: 0,
    defaultEnabled: true,
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<CollectionsIcon sx={{ fontSize: 32 }} />}
        count={summary.collection_count}
        label={t("dashboard.collectionCount.label")}
        onClick={() => navigate("/models/collections")}
      />
    ),
  },
  {
    id: "modelCount",
    labelKey: "dashboard.modelCount.label",
    column: 0,
    defaultEnabled: true,
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<ViewInArIcon sx={{ fontSize: 32 }} />}
        count={summary.model_count}
        label={t("dashboard.modelCount.label")}
        onClick={() => navigate("/models")}
      />
    ),
  },
  {
    id: "authorCount",
    labelKey: "dashboard.authorCount.label",
    column: 0,
    defaultEnabled: true,
    render: ({ summary, t }) => (
      <CountCard
        icon={<PersonIcon sx={{ fontSize: 32 }} />}
        count={summary.author_count}
        label={t("dashboard.authorCount.label")}
      />
    ),
  },
  {
    id: "categoryCount",
    labelKey: "dashboard.categoryCount.label",
    column: 0,
    defaultEnabled: true,
    render: ({ summary, t, navigate }) => (
      <CountCard
        icon={<FolderIcon sx={{ fontSize: 32 }} />}
        count={summary.category_count}
        label={t("dashboard.categoryCount.label")}
        onClick={() => navigate("/models")}
      />
    ),
  },
  {
    id: "topViewed",
    labelKey: "dashboard.topViewed.title",
    column: 1,
    defaultEnabled: true,
    render: ({ summary, t }) => (
      <ModelListCard
        icon={<VisibilityIcon />}
        title={t("dashboard.topViewed.title")}
        models={summary.top_viewed}
        valueOf={(m) => m.view_count}
        valueLabel={(count) => t("dashboard.viewCount", { count })}
        emptyText={t("dashboard.topViewed.empty")}
        seeMoreLabel={t("dashboard.seeMore")}
        fetchMore={dashboardApi.getTopViewed}
      />
    ),
  },
  {
    id: "topPrinted",
    labelKey: "dashboard.topPrinted.title",
    column: 1,
    defaultEnabled: true,
    render: ({ summary, t }) => (
      <ModelListCard
        icon={<PrintIcon />}
        title={t("dashboard.topPrinted.title")}
        models={summary.top_printed}
        valueOf={(m) => m.print_count}
        valueLabel={(count) => t("dashboard.printCount", { count })}
        emptyText={t("dashboard.topPrinted.empty")}
        seeMoreLabel={t("dashboard.seeMore")}
        fetchMore={dashboardApi.getTopPrinted}
      />
    ),
  },
  {
    id: "recentlyAdded",
    labelKey: "dashboard.recentlyAdded.title",
    column: 1,
    defaultEnabled: true,
    render: ({ summary }) => <RecentlyAddedCard models={summary.recently_added} />,
  },
  {
    id: "topAuthors",
    labelKey: "dashboard.topAuthors.title",
    column: 2,
    defaultEnabled: true,
    render: ({ summary }) => <AuthorListCard authors={summary.top_authors} />,
  },
  {
    id: "topProviders",
    labelKey: "dashboard.topProviders.title",
    column: 2,
    defaultEnabled: true,
    render: ({ summary }) => <ProviderListCard providers={summary.top_providers} />,
  },
];

export function isWidgetEnabled(widget: DashboardWidget, choices: DashboardWidgetChoices): boolean {
  return choices[widget.id] ?? widget.defaultEnabled;
}
