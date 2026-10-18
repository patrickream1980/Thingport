import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { UnauthorizedError } from "../../api/client";
import { type Print, printsApi } from "../../api/prints";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { dividerBorderColor } from "../../theme";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useSmartBack } from "../../components/Layout/NavigationHistoryContext";
import Model3DPreviewModal from "./Model3DPreviewModal";
import ModelActionsMenu from "./ModelActionsMenu";
import FavoriteButton from "./FavoriteButton";
import ModelSidePanel from "./ModelSidePanel";
import MarkdownDescription from "../../components/MarkdownDescription";
import PlateThumbnail from "../../components/media/PlateThumbnail";

type Props = {
  theme: ResolvedTheme;
  onSelectCategory: (id: string) => void;
  onUnauthorized?: () => void;
  viewer?: AuthUser | null;
};

export default function ModelDetailPage({ theme, onSelectCategory, onUnauthorized, viewer }: Props) {
  const { printId } = useParams<{ printId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["models", "common", "library"]);
  const [print, setPrint] = useState<Print | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activePlateIndex, setActivePlateIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPlateId, setPreviewPlateId] = useState<string | null>(null);

  // Returns wherever the user came from; useSmartBack skips same-route history entries.
  const goBack = useSmartBack();

  usePageHeader({
    title: print ? print.title || print.name : undefined,
    subtitle: print ? t("models:detail.subtitle") : undefined,
    actions: print ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <FavoriteButton print={print} onUpdated={setPrint} onUnauthorized={onUnauthorized} />
        <ModelActionsMenu
          print={print}
          onUnauthorized={onUnauthorized}
          onDeleted={goBack}
          onUpdated={setPrint}
          viewer={viewer}
        />
      </Stack>
    ) : undefined,
  });

  useEffect(() => {
    if (!printId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const data = await printsApi.get(printId);
        if (cancelled) return;
        setPrint(data);
        setActivePlateIndex(0);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized?.();
          return;
        }
        console.error(err);
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [printId, onUnauthorized]);

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress size={22} />
      </Stack>
    );
  }

  if (notFound || !print) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:errors.notFound")}</Typography>
      </Stack>
    );
  }

  const plates = print.plates.toSorted((a, b) => a.position - b.position);
  const activePlate = plates[activePlateIndex] || plates[0];
  const canPreview3d = Boolean(activePlate) && MODEL_EXTS.has(extOf(activePlate?.filename || ""));

  const goPrevFile = () => setActivePlateIndex((i) => (i - 1 + plates.length) % plates.length);
  const goNextFile = () => setActivePlateIndex((i) => (i + 1) % plates.length);

  return (
    <Box sx={{ maxWidth: "1390px", mx: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
          gap: "24px",
          alignItems: "start",
        }}
      >
        {/* minWidth: 0 -- without it, a grid item defaults to min-width: auto, so a preview image
            with huge intrinsic pixel dimensions could still force this column wider than its "2fr"
            share (and skew the whole two-column layout) even though the image itself is capped
            below. */}
        <Box sx={{ minWidth: 0 }}>
          <Box
            sx={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 10",
              borderRadius: "12px",
              overflow: "hidden",
              bgcolor: "background.paper",
            }}
          >
            {activePlate && renderPreviewContent(print, "modal", theme, t, "on-demand", activePlate)}

            {plates.length > 1 && (
              <>
                <IconButton
                  onClick={goPrevFile}
                  aria-label="Previous file"
                  sx={{
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    bgcolor: "rgba(0, 0, 0, 0.45)",
                    color: "#fff",
                    "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
                  }}
                >
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton
                  onClick={goNextFile}
                  aria-label="Next file"
                  sx={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    bgcolor: "rgba(0, 0, 0, 0.45)",
                    color: "#fff",
                    "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
                  }}
                >
                  <ChevronRightIcon />
                </IconButton>
              </>
            )}

            {activePlate && (
              <Box
                sx={{
                  position: "absolute",
                  top: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 1.5,
                  bgcolor: "rgba(0, 0, 0, 0.55)",
                  color: "#fff",
                  maxWidth: "70%",
                }}
              >
                <Typography variant="caption" noWrap sx={{ display: "block" }}>
                  {plates.length > 1 ? `File ${activePlateIndex + 1} of ${plates.length} — ` : ""}
                  {activePlate.filename}
                </Typography>
              </Box>
            )}

            {canPreview3d && activePlate && (
              <Button
                variant="contained"
                size="small"
                startIcon={<ViewInArIcon fontSize="small" />}
                onClick={() => {
                  setPreviewPlateId(activePlate.id);
                  setPreviewOpen(true);
                }}
                sx={{
                  position: "absolute",
                  left: 12,
                  bottom: 12,
                  bgcolor: "rgba(0, 0, 0, 0.65)",
                  color: "#fff",
                  "&:hover": { bgcolor: "rgba(0, 0, 0, 0.8)" },
                }}
              >
                {t("models:detail.preview3d")}
              </Button>
            )}
          </Box>

          {plates.length > 1 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                Files ({plates.length}) — scroll horizontally or use the arrows above
              </Typography>
              <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.75 }}>
                {plates.map((plate, idx) => (
                  <ButtonBase
                    key={plate.id}
                    onClick={() => setActivePlateIndex(idx)}
                    title={plate.filename}
                    sx={{
                      width: 160,
                      minWidth: 160,
                      p: 0.75,
                      border: "2px solid",
                      borderColor: idx === activePlateIndex ? "primary.main" : "divider",
                      borderRadius: 1.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      justifyContent: "flex-start",
                      textAlign: "left",
                      bgcolor: "background.paper",
                    }}
                  >
                    <PlateThumbnail plate={plate} />
                    <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
                      {plate.filename}
                    </Typography>
                  </ButtonBase>
                ))}
              </Stack>
            </Box>
          )}

          <Paper
            variant="outlined"
            sx={{
              mt: 3,
              p: 2,
              borderRadius: "12px",
              borderColor: dividerBorderColor,
            }}
          >
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{ mb: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              {t("models:detail.description")}
            </Typography>
            {print.notes?.trim() ? (
              <MarkdownDescription markdown={print.notes} />
            ) : (
              <Typography variant="body2" color="text.disabled">
                {t("models:detail.noDescription")}
              </Typography>
            )}

            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{ mt: 2.5, mb: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              {t("models:detail.tags")}
            </Typography>
            {print.tags.length ? (
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
                {print.tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    variant="outlined"
                    onClick={() => navigate(`/models/tags/${encodeURIComponent(tag)}`)}
                    sx={{
                      bgcolor: "background.paper",
                      borderColor: "divider",
                      color: "text.primary",
                      // !important: Chip's own clickable styles use a same-specificity selector.
                      "&:hover, &:focus-visible, &:active": {
                        backgroundColor: (muiTheme) => `${muiTheme.palette.background.paper} !important`,
                      },
                    }}
                  />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.disabled">
                {t("models:detail.noTags")}
              </Typography>
            )}
          </Paper>
        </Box>

        {/* alignSelf: stretch overrides the grid's own alignItems: "start" just for this column,
            so this box is as tall as the (taller) left column -- giving the sticky panel inside
            it room to travel as the page scrolls instead of being stuck the moment its own
            (short) content ends. */}
        <Box sx={{ alignSelf: "stretch" }}>
          <ModelSidePanel
            print={print}
            onSelectCategory={onSelectCategory}
            onUnauthorized={onUnauthorized}
            onUpdated={setPrint}
            viewer={viewer}
          />
        </Box>
      </Box>

      {previewOpen && (
        <Model3DPreviewModal
          print={print}
          initialPlateId={previewPlateId}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </Box>
  );
}
