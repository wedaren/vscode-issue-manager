/**
 * 把 mermaid 输出的 SVG 规范化为显式像素尺寸：
 * - 读 viewBox 拿到自然宽高
 * - 删除 mermaid 的 `width="100%"`、`height="..."`、`style="max-width:..."`（这些会让 SVG 在 `<img>` 里退化到 300x150 默认或 0×0）
 * - 写入 `width="<vw>"` / `height="<vh>"` 属性
 *
 * 处理后 SVG 在 `<img>` 中以 vw×vh 像素为自然尺寸，可被 CSS `width:100%` 等比缩放；
 * 在 webview 内嵌时也以 vw×vh 像素布局，便于 fit() 计算。
 */
export function normalizeSvg(svg: string): string {
    const vbMatch = svg.match(/viewBox="([^"]+)"/i);
    if (!vbMatch) { return svg; }
    const parts = vbMatch[1].trim().split(/\s+/).map(Number);
    if (parts.length !== 4) { return svg; }
    const vw = parts[2];
    const vh = parts[3];
    if (!isFinite(vw) || !isFinite(vh) || vw <= 0 || vh <= 0) { return svg; }

    let result = svg
        .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
        .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
        .replace(/(<svg\b[^>]*?)\s+style="[^"]*"/i, '$1');

    const w = Math.round(vw);
    const h = Math.round(vh);
    result = result.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
    return result;
}
