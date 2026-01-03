export function segmentText(text: string, maxChars = 1200): string[] {
  if (!text) return [];
  // 先按空行或句号分段
  const paras = text.split(/\n\s*\n|(?<=\.|\?|!)\s+/g).map(p => p.trim()).filter(p => p.length);
  const segments: string[] = [];
  for (const p of paras) {
    if (p.length <= maxChars) {
      segments.push(p);
    } else {
      // 超长段落按字符切分为多个段
      for (let i = 0; i < p.length; i += maxChars) {
        segments.push(p.slice(i, i + maxChars));
      }
    }
  }
  return segments;
}
