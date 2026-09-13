export const annotationColors = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
];
export function validateAnnotation(a) {
  if (
    !a ||
    !/^[A-Z2-9]{8}$/.test(a.key || "") ||
    !["highlight", "underline"].includes(a.type) ||
    typeof a.text !== "string" ||
    a.text.length > 16000 ||
    typeof a.comment !== "string" ||
    a.comment.length > 8000 ||
    !annotationColors.includes(a.color) ||
    !/^\d{5}\|\d{6}\|\d{5}$/.test(a.sortIndex || "") ||
    typeof a.pageLabel !== "string" ||
    a.pageLabel.length > 30 ||
    !Number.isInteger(a.position?.pageIndex) ||
    a.position.pageIndex < 0 ||
    a.position.pageIndex > 99998 ||
    !Array.isArray(a.position.rects) ||
    !a.position.rects.length ||
    a.position.rects.length > 200 ||
    a.position.rects.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 4 ||
        r.some((n) => !Number.isFinite(n) || Math.abs(n) > 100000) ||
        r[0] >= r[2] ||
        r[1] >= r[3],
    )
  )
    throw new Error("标注格式或 PDF 坐标无效。");
  return {
    key: a.key,
    type: a.type,
    text: a.text,
    comment: a.comment,
    color: a.color,
    pageLabel: a.pageLabel,
    sortIndex: a.sortIndex,
    position: { pageIndex: a.position.pageIndex, rects: a.position.rects },
  };
}
export function annotationValue(a) {
  const clean = validateAnnotation(a);
  return JSON.stringify(clean);
}
export function collectionPaths(collections) {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  function path(key, seen = new Set()) {
    const c = byKey.get(key);
    if (!c || seen.has(key)) return [];
    seen.add(key);
    return [...(c.parentKey ? path(c.parentKey, seen) : []), c.name];
  }
  return collections.map((c) => ({ ...c, path: path(c.key).join(" / ") }));
}
export function inCollection(keys, selected, collections) {
  if (!selected) return true;
  const byKey = new Map(collections.map((c) => [c.key, c]));
  return keys.some((key) => {
    const seen = new Set();
    while (key && !seen.has(key)) {
      if (key === selected) return true;
      seen.add(key);
      key = byKey.get(key)?.parentKey;
    }
    return false;
  });
}
