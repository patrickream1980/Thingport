import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type PrintSortMode } from "../../api/prints";

const SORT_MODES: PrintSortMode[] = ["newest", "name"];

type Props = {
  value: PrintSortMode;
  onChange: (mode: PrintSortMode) => void;
};

/** Sort models by recency or alphabetically by display name. */
export default function SortTabs({ value, onChange }: Props) {
  const { t } = useTranslation("models");
  return (
    <Stack direction="row" spacing={3}>
      {SORT_MODES.map((mode) => (
        <Typography
          key={mode}
          variant="body2"
          onClick={() => onChange(mode)}
          sx={{
            cursor: "pointer",
            fontSize: 14,
            fontWeight: value === mode ? 700 : 500,
            color: value === mode ? "primary.main" : "text.secondary",
            "&:hover": { color: "primary.main" },
          }}
        >
          {t(`sort.${mode}`)}
        </Typography>
      ))}
    </Stack>
  );
}
