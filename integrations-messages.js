// Validation messages of the integrations resolver, English by default; the host may switch with
// setIntegrationsLocale(). The zh strings are kept as \u escapes so this source stays ASCII (a user-facing
// dictionary, not hardcoded UI text).
const dictionaries = {
  en: {
    notUrl: "is not a valid URL",
    localOrHttps: "must be an https URL (http://127.0.0.1 is allowed for this machine) without credentials or query parameters",
    httpsOnly: "must be an https URL without credentials or query parameters",
    engineList: "must be a non-empty list of {allowed}",
    envName: "must be an environment variable name (upper-case letters, digits, underscores)",
    path: "must be a path starting with /",
    headersObject: "must be a {name: value} object",
    headerForbidden: "cannot set the request header {name} (keys are injected through apiKeyEnv)",
    headerValue: "the value of request header {name} is invalid",
    providerList: "must be a list of channel names",
    noWhitespace: "must be a string without whitespace",
    intRange: "must be an integer from {min} to {max}",
    msRange: "must be {min}-{max} milliseconds",
    byteRange: "must be {min}-{max} bytes",
    oneOf: "must be {values}",
    or: " or ",
    accountName: "must be 1-64 letters, digits or ._@-",
    unsupportedField: "is not a supported field",
    integrationsObject: "integrations must be an object",
    integrationsSection: "integrations does not support {section}",
    integrationsSectionObject: "integrations.{section} must be an object",
    fileCorrupt: "integrations file is corrupt: {reason}",
  },
  zh: {
    notUrl: "\u4e0d\u662f\u5408\u6cd5\u5730\u5740",
    localOrHttps: "\u987b\u4e3a https \u5730\u5740\uff08\u672c\u673a\u53ef\u7528 http://127.0.0.1\uff09\uff0c\u4e0d\u542b\u8d26\u53f7\u548c\u67e5\u8be2\u53c2\u6570",
    httpsOnly: "\u987b\u4e3a\u4e0d\u542b\u8d26\u53f7\u3001\u67e5\u8be2\u53c2\u6570\u7684 https \u5730\u5740",
    engineList: "\u987b\u4e3a\u975e\u7a7a\u5217\u8868\uff0c\u53d6\u503c {allowed}",
    envName: "\u987b\u4e3a\u73af\u5883\u53d8\u91cf\u540d\uff08\u5927\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u4e0b\u5212\u7ebf\uff09",
    path: "\u987b\u4e3a\u4ee5 / \u5f00\u5934\u7684\u8def\u5f84",
    headersObject: "\u987b\u4e3a {\u540d\u79f0: \u503c} \u5bf9\u8c61",
    headerForbidden: "\u4e0d\u80fd\u8bbe\u7f6e\u8bf7\u6c42\u5934 {name}\uff08\u5bc6\u94a5\u901a\u8fc7 apiKeyEnv \u6ce8\u5165\uff09",
    headerValue: "\u8bf7\u6c42\u5934 {name} \u7684\u503c\u65e0\u6548",
    providerList: "\u987b\u4e3a\u6e20\u9053\u540d\u5217\u8868",
    noWhitespace: "\u987b\u4e3a\u4e0d\u542b\u7a7a\u767d\u7684\u5b57\u7b26\u4e32",
    intRange: "\u987b\u4e3a {min}\u2013{max} \u7684\u6574\u6570",
    msRange: "\u987b\u4e3a {min}\u2013{max} \u6beb\u79d2",
    byteRange: "\u987b\u4e3a {min}\u2013{max} \u5b57\u8282",
    oneOf: "\u987b\u4e3a {values}",
    or: " \u6216 ",
    accountName: "\u987b\u4e3a 1\u201364 \u4f4d\u5b57\u6bcd\u3001\u6570\u5b57\u6216 ._@-",
    unsupportedField: "\u4e0d\u662f\u652f\u6301\u7684\u5b57\u6bb5",
    integrationsObject: "integrations \u987b\u4e3a\u5bf9\u8c61",
    integrationsSection: "integrations \u4e0d\u652f\u6301 {section}",
    integrationsSectionObject: "integrations.{section} \u987b\u4e3a\u5bf9\u8c61",
    fileCorrupt: "\u96c6\u6210\u914d\u7f6e\u6587\u4ef6\u635f\u574f\uff1a{reason}",
  },
};
let locale = 'en';
/** 'zh', 'zh-CN', ... select Chinese; anything else English. */
export function setIntegrationsLocale(next) { locale = String(next ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'; }
export const integrationsLocale = () => locale;
/** The message for `key` with `{name}` placeholders filled from `values`. */
export function message(key, values = {}) {
  const text = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}
