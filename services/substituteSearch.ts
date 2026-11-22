import type { QuranTeacherSessionSubstitute } from "./djangoApiService";

export function filterSubstituteTeachers(
  substitutes: QuranTeacherSessionSubstitute[],
  query: string,
): QuranTeacherSessionSubstitute[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return substitutes;
  }

  const normalizedIdQuery = trimmed.replace(/^(id[:\s#]*|#)+/, "");

  return substitutes.filter((teacher) => {
    const nameMatch = teacher.name.toLowerCase().includes(trimmed);
    const idText = String(teacher.id);
    const idMatch =
      idText.includes(trimmed) ||
      (normalizedIdQuery.length > 0 && idText.includes(normalizedIdQuery));
    return nameMatch || idMatch;
  });
}
