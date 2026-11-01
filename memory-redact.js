// Secret filter applied to every memory before it is stored locally or sent to an external memory service.
// Memories are recalled into other members' prompts later, so a leaked token would spread; values are
// replaced with a marker instead of rejecting the whole memory, which usually still carries the useful lesson.
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-(?:[A-Za-z0-9_-]{2,16}-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{16,}/gi,
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@\/]+:[^\s@\/]+@/gi,
  /\b((?:api[_-]?key|access[_-]?token|secret|password|passwd|pwd|token|auth)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
];
export const REDACTED = '[已隐去凭据]';
/** Text with likely secrets replaced; `extra` are exact values (e.g. keys from the credential store). */
export function redactSecrets(text, extra = []) {
  let out = String(text ?? '');
  for (const value of extra) if (typeof value === 'string' && value.length >= 8) out = out.split(value).join(REDACTED);
  for (const re of PATTERNS) {
    out = out.replace(re, (match, prefix) => {
      if (/^(bearer|basic)$/i.test(prefix ?? '')) return `${prefix} ${REDACTED}`;
      if (typeof prefix === 'string' && /[:=@]|:\/\/$/.test(prefix)) return prefix.endsWith('://') ? `${prefix}${REDACTED}@` : `${prefix}${REDACTED}`;
      return REDACTED;
    });
  }
  return out;
}
