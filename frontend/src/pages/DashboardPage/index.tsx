import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { UnauthorizedError } from "../../api/client";
import { dashboardApi, type DashboardSummary } from "../../api/dashboard";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useDashboardWidgets } from "../../hooks/useDashboardWidgets";
import DashboardWidgetsDialog from "./DashboardWidgetsDialog";
import { DASHBOARD_WIDGETS, isWidgetEnabled } from "./widgets";

// Relative widths of the three columns on a wide screen: counts, then the two list columns.
const COLUMN_FLEX = [1, 1.4, 1.4];

type Props = {
  onUnauthorized?: () => void;
};

export default function DashboardPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [choices, setWidgetEnabled] = useDashboardWidgets();
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  usePageHeader({
    actions: (
      <Tooltip title={t("dashboard.widgets.open")}>
        <IconButton size="small" onClick={() => setSettingsOpen(true)} aria-label={t("dashboard.widgets.open")}>
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    ),
  });

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await dashboardApi.getSummary();
        if (active) setSummary(data);
      } catch (err) {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("dashboard.loadError"));
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  let content: React.ReactNode;
  if (error) {
    content = (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  } else if (!summary || !choices) {
    content = (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 10 }}>
        <CircularProgress />
      </Stack>
    );
  } else {
    const enabled = DASHBOARD_WIDGETS.filter((widget) => isWidgetEnabled(widget, choices));
    // A column with nothing left in it is dropped, so the others widen into its space.
    const columns = COLUMN_FLEX.map((flex, column) => ({
      column,
      flex,
      widgets: enabled.filter((widget) => widget.column === column),
    })).filter((column) => column.widgets.length > 0);

    content = columns.length ? (
      <Box sx={{ p: { xs: 0, md: 1 } }}>
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, alignItems: "flex-start" }}>
          {columns.map((column) => (
            <Box
              key={column.column}
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                width: { xs: "100%", md: 0 },
                flex: { md: column.flex },
              }}
            >
              {column.widgets.map((widget) => (
                <React.Fragment key={widget.id}>{widget.render({ summary, t, navigate })}</React.Fragment>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    ) : (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 10, textAlign: "center" }}>
        <Typography color="text.secondary">{t("dashboard.widgets.allHidden")}</Typography>
        <Button variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => setSettingsOpen(true)}>
          {t("dashboard.widgets.open")}
        </Button>
      </Stack>
    );
  }

  return (
    <>
      {content}
      <DashboardWidgetsDialog
        open={settingsOpen}
        choices={choices ?? {}}
        onToggle={setWidgetEnabled}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
