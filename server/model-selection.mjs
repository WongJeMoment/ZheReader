// Only route translation automatically. Other actions preserve the user's choice.
export function selectStudyModel(models, input) {
  const fallback = models.find((m) => m.isDefault) ||
    models.find((m) => !m.hidden) || models[0];
  if (input.action === "translate") {
    return models.find((m) => m.model === "gpt-5.6-luna") || fallback;
  }
  return input.model
    ? models.find((m) => m.model === input.model) || { model: input.model }
    : fallback;
}
