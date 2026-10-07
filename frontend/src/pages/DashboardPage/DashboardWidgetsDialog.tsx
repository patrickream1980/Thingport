import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import type { DashboardWidgetChoices, DashboardWidgetId } from "../../api/settings";
import { DASHBOARD_WIDGETS, isWidgetEnabled } from "./widgets";

type Props = {
  open: boolean;
  choices: DashboardWidgetChoices;
  onToggle: (id: DashboardWidgetId, enabled: boolean) => void;
  onClose: () => void;
};

/** Each switch applies straight away, so the dashboard behind updates as the user goes. */
export default function DashboardWidgetsDialog({ open, choices, onToggle, onClose }: Props) {
  const { t } = useTranslation("app");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Stack>
          {t("dashboard.widgets.title")}
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.widgets.subtitle")}
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label={t("dashboard.widgets.close") ?? undefined}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack>
          {DASHBOARD_WIDGETS.map((widget) => (
            <FormControlLabel
              key={widget.id}
              labelPlacement="start"
              label={t(widget.labelKey)}
              control={
                <Switch
                  checked={isWidgetEnabled(widget, choices)}
                  onChange={(event) => onToggle(widget.id, event.target.checked)}
                />
              }
              sx={{ mx: 0, justifyContent: "space-between" }}
            />
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
