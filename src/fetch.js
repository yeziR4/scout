// Small HTTP helpers with timeouts. No dependencies beyond global fetch.

export async function fetchText(url, { timeoutMs = 12000, headers = {} } = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': 'scout-arena/0.1', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    url: res.url,
    contentType: res.headers.get('content-type') || '',
    text,
    ms: Date.now() - started,
  };
}

// Turn a product link into the most useful document to read.
// GitHub repo URLs resolve to the raw README; everything else is fetched as is.
export function candidateDocUrls(link) {
  const out = [];
  let u;
  try { u = new URL(link); } catch { return [link]; }
  if (u.hostname === 'github.com') {
    const [owner, repo, kind, branch, ...rest] = u.pathname.split('/').filter(Boolean);
    if (owner && repo) {
      if (kind === 'blob' && branch) {
        out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`);
      } else {
        const b = kind === 'tree' && branch ? [branch] : ['HEAD', 'main', 'master'];
        for (const br of b) {
          out.push(`https://raw.githubusercontent.com/${owner}/${repo}/${br}/README.md`);
        }
      }
    }
  }
  out.push(link);
  return [...new Set(out)];
}

export async function fetchProductDoc(link) {
  const errors = [];
  for (const url of candidateDocUrls(link)) {
    try {
      const r = await fetchText(url);
      if (r.ok && r.text.trim()) return { ...r, source: url, text: htmlToText(r) };
      errors.push(`${url}: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  return { ok: false, errors };
}

function htmlToText(r) {
  if (!/html/i.test(r.contentType) && !/^\s*<!doctype html/i.test(r.text)) return r.text;
  return r.text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/pre|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}
