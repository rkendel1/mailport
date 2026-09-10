function valueAsString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function renderTemplate(template, variables = {}) {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) =>
    valueAsString(variables[key])
  );
}

export function extractLinks({ html = "", text = "" }) {
  const links = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let href;
  while ((href = hrefPattern.exec(html)) !== null) {
    links.add(href[1].replace(/[),.;]+$/, ""));
  }

  const plainText = `${html.replace(/<[^>]*>/g, " ")}\n${text}`;
  const urlPattern = /https?:\/\/[^\s"'<>]+|(?:^|\s)(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
  let match;
  while ((match = urlPattern.exec(plainText)) !== null) {
    const value = (match[1] || match[0]).trim();
    if (value) links.add(value.replace(/[),.;]+$/, ""));
  }
  return [...links];
}
