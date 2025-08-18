import * as https from 'https';
import * as http from 'http';

/**
 * RSS网络请求工具类
 */
export class RSSFetcher {
    /**
     * 获取RSS内容
     */
    public static async fetchContent(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; VSCode-Issue-Manager/1.0)',
                    'Accept': 'application/json, application/rss+xml, application/xml, text/xml, application/atom+xml'
                }
            };

            const req = client.request(options, (res) => {
                let data = '';

                // 检查状态码
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve(data);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(30000, () => {
                req.abort();
                reject(new Error('请求超时'));
            });

            req.end();
        });
    }
}
