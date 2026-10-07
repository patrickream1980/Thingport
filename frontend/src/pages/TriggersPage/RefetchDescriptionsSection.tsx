import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { adminApi, type AdminUser, type DescriptionRefetchStatus } from "../../api/admin";
import { useConfirm } from "../../components/ConfirmProvider";

type Props = {
  users: AdminUser[];
  onUnauthorized?: () => void;
};

const POLL_MS = 2000;

/** Replaces every imported model's description for one user with the one on its source, e.g. to
 *  bring models imported as plain text up to formatted descriptions with images. */
export default function RefetchDescriptionsSection({ users, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const confirmDialog = useConfirm();
  const [status, setStatus] = React.useState<DescriptionRefetchStatus | null>(null);
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = status?.run ?? null;
  const running = Boolean(run?.running);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await adminApi.getDescriptionRefetch());
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
    }
  }, [onUnauthorized]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const countOf = (userId: string) => status?.counts[userId] ?? 0;
  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;
  const runUser = run ? users.find((u) => u.id === run.userId) : null;

  const start = async () => {
    if (!selectedUser) return;
    const confirmed = await confirmDialog({
      message: t("adminSettings.triggers.refetchConfirm", {
        count: countOf(selectedUser.id),
        email: selectedUser.email,
      }),
      confirmLabel: t("adminSettings.triggers.refetchConfirmButton"),
    });
    if (!confirmed) return;
    setStarting(true);
    setError(null);
    try {
      const started = await adminApi.startDescriptionRefetch(selectedUser.id);
      setStatus((prev) => (prev ? { ...prev, run: started.run } : prev));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.triggers.refetchFailed"));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {t("adminSettings.triggers.refetchTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("adminSettings.triggers.refetchDesc")}
          </Typography>
        </Box>

        {running && run ? (
          <Stack spacing={1}>
            <Typography variant="body2">
              {t("adminSettings.triggers.refetchProgress", {
                email: runUser?.email ?? "",
                done: run.done,
                total: run.total,
                updated: run.updated,
              })}
            </Typography>
            <LinearProgress
              variant={run.total ? "determinate" : "indeterminate"}
              value={run.total ? (run.done / run.total) * 100 : undefined}
            />
          </Stack>
        ) : (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 300, maxWidth: "100%" }}>
              <InputLabel id="refetch-user-select-label">{t("adminSettings.triggers.userLabel")}</InputLabel>
              <Select
                labelId="refetch-user-select-label"
                label={t("adminSettings.triggers.userLabel")}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={starting}
              >
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id} disabled={!countOf(u.id)}>
                    {t("adminSettings.triggers.refetchUserOption", {
                      name: u.display_name,
                      email: u.email,
                      count: countOf(u.id),
                    })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={() => void start()}
              disabled={!selectedUser || !countOf(selectedUser.id) || starting}
            >
              {t("adminSettings.triggers.refetchButton")}
            </Button>
          </Stack>
        )}

        {run && !run.running && (
          <Alert severity={run.updated > 0 ? "success" : "info"}>
            {t("adminSettings.triggers.refetchDone", {
              email: runUser?.email ?? "",
              updated: run.updated,
              total: run.total,
            })}
            {run.failed > 0 && ` ${t("adminSettings.triggers.refetchFailedCount", { count: run.failed })}`}
          </Alert>
        )}
        {run?.problems.map((problem) => (
          <Alert key={problem} severity="warning">
            {t(`adminSettings.triggers.linkAuthorsProblems.${problem}`)}
          </Alert>
        ))}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
