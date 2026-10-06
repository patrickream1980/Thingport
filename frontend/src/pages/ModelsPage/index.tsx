import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Button from "@mui/material/Button";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type Category, type CategoryMetaInput, categoriesApi } from "../../api/categories";
import { type CategoriesView, type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { buildCategoryTree, flattenCategoryTree, subtreeIds } from "../../utils/categoryTree";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useCategoriesView } from "../../hooks/useCategoriesView";
import CategoriesPanel from "./CategoriesPanel";
import CategoriesViewToggle from "./CategoriesViewToggle";
import CategoryBanner from "./CategoryBanner";
import ModelCard from "./ModelCard";
import SortTabs from "./SortTabs";

const PAGE_SIZE = 24;

type Props = {
  categoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  categoriesVersion: number;
  onCategoriesChanged: () => void;
  /** Bumped when prints change elsewhere, to refetch the grid. */
  printsVersion: number;
  onUnauthorized?: () => void;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  viewer?: AuthUser | null;
};

export default function ModelsPage({
  categoryId,
  onSelectCategory,
  categoriesVersion,
  onCategoriesChanged,
  printsVersion,
  onUnauthorized,
  theme,
  previewMode,
  viewer,
}: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__unset__");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoriesView, setCategoriesView] = useCategoriesView();
  const panelKind = categoriesView === "folders" ? "folder" : "category";
  const panelCategories = useMemo(() => categories.filter((c) => c.kind === panelKind), [categories, panelKind]);
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode =
    sortModeParam === "popular" || sortModeParam === "downloads" ? sortModeParam : "newest";

  const setSortMode = (mode: PrintSortMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "newest") next.delete("orderBy");
      else next.set("orderBy", mode);
      return next;
    });
  };

  // Mirrors the selected category into ?category=<id>. When the URL and state disagree, both sync
  // effects fire and undo each other, causing flicker; `syncingFromUrlRef` marks a change that came
  // from the URL so it isn't pushed straight back.
  const categoryParam = searchParams.get("category");
  const syncingFromUrlRef = useRef(false);

  useEffect(() => {
    if (categoryParam !== categoryId) {
      syncingFromUrlRef.current = true;
      onSelectCategory(categoryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryParam]);

  useEffect(() => {
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      return;
    }
    if ((searchParams.get("category") || null) === categoryId) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (categoryId) next.set("category", categoryId);
      else next.delete("category");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // A category includes the models at every level beneath it.
  const categoryIdFilter = useMemo(() => {
    if (!categoryId) return undefined;
    const ids = subtreeIds(buildCategoryTree(categories), categoryId);
    return ids.length === 1 ? categoryId : ids;
  }, [categoryId, categories]);

  const selectedCategory = categoryId ? (categories.find((f) => f.id === categoryId) ?? null) : null;
  const [flatCategories, flatFolders] = useMemo(
    () =>
      (["category", "folder"] as const).map((kind) =>
        flattenCategoryTree(buildCategoryTree(categories.filter((c) => c.kind === kind))),
      ),
    [categories],
  );
  const categoryName = (category: Category) => translateCategoryDisplay(category, i18n).name;
  const visibleIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const selectedVisibleCount = useMemo(
    () => Array.from(selectedIds).filter((id) => visibleIds.has(id)).length,
    [selectedIds, visibleIds],
  );
  usePageHeader({
    title: selectedCategory ? selectedCategory.name || t("models:categories.untitled") : undefined,
    subtitle: selectedCategory
      ? t(selectedCategory.kind === "folder" ? "models:folders.subtitle" : "models:categories.subtitle")
      : undefined,
    onBack: categoryId ? () => onSelectCategory(null) : undefined,
  });

  const handleError = (err: unknown, message?: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return true;
    }
    console.error(err);
    if (message) alert(message);
    return false;
  };

  useEffect(() => {
    setCategoriesLoading(true);
    (async () => {
      try {
        setCategories(await categoriesApi.list());
      } catch (err) {
        handleError(err, t("models:errors.loadCategoriesFailed"));
      } finally {
        setCategoriesLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesVersion]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const result = await printsApi.list({
          category_id: categoryIdFilter,
          order_by: sortMode,
          limit: PAGE_SIZE,
          offset: 0,
        });
        setItems(result.items);
        setOffset(result.items.length);
        setHasMore(result.hasMore);
      } catch (err) {
        handleError(err, t("models:errors.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIdFilter, printsVersion, sortMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        category_id: categoryIdFilter,
        order_by: sortMode,
        limit: PAGE_SIZE,
        offset,
      });
      setItems((prev) => [...prev, ...result.items]);
      setOffset(offset + result.items.length);
      setHasMore(result.hasMore);
    } catch (err) {
      handleError(err, t("models:errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore);

  const createCategory = async (name: string, parentId: string | null) => {
    try {
      await categoriesApi.create(name, [], parentId || undefined, panelKind);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.createCategoryFailed"));
    }
  };

  const renameCategory = async (id: string, name: string) => {
    const existing = categories.find((f) => f.id === id);
    try {
      await categoriesApi.update(id, name, existing?.tags || [], existing?.parent_id || undefined);
      onCategoriesChanged();
    } catch (err) {
      handleError(err, t("models:errors.renameCategoryFailed"));
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await categoriesApi.delete(id);
      onCategoriesChanged();
      if (categoryId === id) onSelectCategory(null);
    } catch (err) {
      handleError(err, t("models:errors.deleteCategoryFailed"));
    }
  };

  // Refetch even on failure: the manager shows the drop optimistically until fresh categories arrive.
  const reorderCategories = async (categoryIds: string[]) => {
    try {
      await categoriesApi.reorder(categoryIds);
    } catch (err) {
      handleError(err, t("models:errors.reorderCategoryFailed"));
    } finally {
      onCategoriesChanged();
    }
  };

  const moveCategory = async (id: string, parentId: string | null, position: number) => {
    try {
      await categoriesApi.move(id, parentId, position);
    } catch (err) {
      handleError(err, t("models:errors.moveCategoryFailed"));
    } finally {
      onCategoriesChanged();
    }
  };

  // A selection from the other box would be invisible after the switch.
  const switchCategoriesView = (view: CategoriesView) => {
    setCategoriesView(view);
    if (selectedCategory && selectedCategory.kind !== (view === "folders" ? "folder" : "category")) {
      onSelectCategory(null);
    }
  };

  const updateCategoryMeta = async (id: string, meta: CategoryMetaInput) => {
    try {
      await categoriesApi.updateMeta(id, meta);
      onCategoriesChanged();
    } catch (err) {
      // Rethrow so CategoryMetaDialog shows the error inline and keeps the user's edits.
      if (handleError(err)) return;
      throw err;
    }
  };

  const toggleSelected = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllVisible = () => setSelectedIds(new Set(items.map((item) => item.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const applyBulkCategory = async () => {
    if (!selectedVisibleCount || bulkUpdating || bulkCategoryId === "__unset__") return;
    setBulkUpdating(true);
    const ids = Array.from(selectedIds).filter((id) => visibleIds.has(id));
    const targetCategoryId = bulkCategoryId || null;
    try {
      const updates = await Promise.all(ids.map((id) => printsApi.updateCategory(id, targetCategoryId)));
      const updatedById = new Map<string, Print>();
      for (const result of updates) {
        const updated = result.print as Print | undefined;
        if (updated) updatedById.set(updated.id, updated);
      }

      const targetIsInCurrentFilter =
        categoryIdFilter === undefined ||
        (targetCategoryId !== null &&
          (Array.isArray(categoryIdFilter)
            ? categoryIdFilter.includes(targetCategoryId)
            : categoryIdFilter === targetCategoryId));

      setItems((prev) =>
        prev
          .filter((item) => !ids.includes(item.id) || targetIsInCurrentFilter)
          .map((item) => updatedById.get(item.id) ?? item),
      );
      clearSelection();
      setBulkCategoryId("__unset__");
    } catch (err) {
      handleError(err, "Failed to update selected models");
    } finally {
      setBulkUpdating(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <CategoriesViewToggle value={categoriesView} onChange={switchCategoriesView} />
        <SortTabs value={sortMode} onChange={setSortMode} />
      </Box>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <CategoriesPanel
          kind={panelKind}
          categories={panelCategories}
          loading={categoriesLoading || categoriesView === null}
          selectedId={categoryId}
          onSelect={onSelectCategory}
          onCreate={createCategory}
          onRename={renameCategory}
          onDelete={deleteCategory}
          onReorder={reorderCategories}
          onMove={moveCategory}
          onUpdateMeta={updateCategoryMeta}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {selectedCategory?.meta_title && (
            <Box sx={{ mb: 2 }}>
              <CategoryBanner category={selectedCategory} />
            </Box>
          )}
          {selectedVisibleCount > 0 && (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
              sx={{ mb: 2, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
            >
              <Typography variant="body2" sx={{ minWidth: 110 }}>
                {selectedVisibleCount} selected
              </Typography>
              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel id="bulk-category-label">{t("models:edit.categoryOrFolder")}</InputLabel>
                <Select
                  labelId="bulk-category-label"
                  label={t("models:edit.categoryOrFolder")}
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  disabled={bulkUpdating}
                >
                  <MenuItem value="__unset__" disabled>
                    Choose a category or folder
                  </MenuItem>
                  <MenuItem value="">{t("models:edit.noCategory")}</MenuItem>
                  {flatCategories.map(({ category, depth }) =>
                    depth === 0 ? (
                      <MenuItem key={category.id} disabled divider sx={{ fontWeight: 700, opacity: "1 !important" }}>
                        {categoryName(category)}
                      </MenuItem>
                    ) : (
                      <MenuItem key={category.id} value={category.id} sx={{ pl: 1 + depth * 2 }}>
                        {categoryName(category)}
                      </MenuItem>
                    ),
                  )}
                  {flatFolders.length > 0 && (
                    <MenuItem disabled divider sx={{ fontWeight: 700, opacity: "1 !important" }}>
                      {t("models:folders.title")}
                    </MenuItem>
                  )}
                  {flatFolders.map(({ category, depth }) => (
                    <MenuItem key={category.id} value={category.id} sx={{ pl: 2 + depth * 2 }}>
                      {categoryName(category) || t("models:categories.untitled")}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={applyBulkCategory}
                disabled={bulkUpdating || bulkCategoryId === "__unset__"}
              >
                {bulkUpdating ? <CircularProgress size={16} color="inherit" /> : "Assign category"}
              </Button>
              <Button onClick={clearSelection} disabled={bulkUpdating}>
                Clear
              </Button>
            </Stack>
          )}
          {items.length > 0 && !loading && (
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <Button size="small" onClick={selectAllVisible} disabled={selectedVisibleCount === items.length}>
                Select all loaded
              </Button>
              {selectedVisibleCount > 0 && (
                <Button size="small" onClick={clearSelection}>
                  Deselect all
                </Button>
              )}
            </Stack>
          )}
          {loading ? (
            <Stack alignItems="center" sx={{ py: 8 }}>
              <CircularProgress size={22} />
            </Stack>
          ) : items.length ? (
            <Stack spacing={2}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  columnGap: "20px",
                  rowGap: "20px",
                  "@media (max-width: 1979px)": { gridTemplateColumns: "repeat(5, 1fr)" },
                  "@media (max-width: 1684px)": { gridTemplateColumns: "repeat(4, 1fr)" },
                  "@media (max-width: 1404px)": { gridTemplateColumns: "repeat(3, 1fr)" },
                  "@media (max-width: 1124px)": { gridTemplateColumns: "repeat(2, 1fr)" },
                  "@media (max-width: 860px)": { gridTemplateColumns: "repeat(1, 1fr)" },
                }}
              >
                {items.map((item) => (
                  <ModelCard
                    key={item.id}
                    item={item}
                    theme={theme}
                    previewMode={previewMode}
                    onDeleted={(deletedId) => setItems((prev) => prev.filter((i) => i.id !== deletedId))}
                    onFavoriteChange={(updated) =>
                      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                    }
                    onUpdated={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                    onUnauthorized={onUnauthorized}
                    viewer={viewer}
                    selectionMode
                    selected={selectedIds.has(item.id)}
                    onSelectionChange={(selected) => toggleSelected(item.id, selected)}
                  />
                ))}
              </Box>
              {hasMore && (
                <Stack ref={loadMoreSentinelRef} direction="row" justifyContent="center" sx={{ py: 1 }}>
                  {loadingMore && (
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
                      <CircularProgress size={14} />
                      <Typography variant="caption">{t("models:grid.loadingMore")}</Typography>
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
          ) : (
            <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
              <Typography variant="body2">{t("models:grid.empty")}</Typography>
            </Stack>
          )}
        </Box>
      </Stack>
    </Stack>
  );
}
