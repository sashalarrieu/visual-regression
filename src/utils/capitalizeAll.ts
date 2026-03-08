export function capitalizeAll(str: string, locale: string = "fr-FR"): string {
  if (!str) return str;
  const normalized = str.normalize("NFC");
  const wordRe = /[\p{L}]+(?:[''][\p{L}]+)*/gu;
  return normalized.replace(wordRe, word => {
    const [first, ...rest] = [...word];
    return first.toLocaleUpperCase(locale) + rest.join("").toLocaleLowerCase(locale);
  });
}
