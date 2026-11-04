# Autocomplete for DSH

Part of [Capability Team for DSH](https://github.com/walke2019/dsh-capability-team) ([main README](../../README.md)); usable on its own in any session.

```bash
dsh plugin add dsh-capability-autocomplete
```

Requires DSH >= 0.2.1-rc.3 and Node.js >= 22.

Composer autocomplete for DSH Web (`dsh-capability-autocomplete`, patch id `autocomplete`):

- **Inline continuation**: pause while typing and a grey continuation appears after the caret.
- **Next message**: after the assistant replies, an empty composer suggests what you might ask next.
- **Tab** accepts the suggestion into the draft, **Alt+Up/Down** cycles candidates, **Esc** dismisses. A suggestion is never sent automatically.
- Suggestions stay out of the way of slash commands (`/…`) and references (`@…`), IME composition, and a running turn.

## Model routing

| `routeMode` | Behavior |
|---|---|
| `session` (default) | Use the provider and model of the session you are typing in. |
| `fixed` | Use the configured `provider` and `model` (both required), e.g. a cheap low-latency model. |

`provider` is the ID of a provider you already configured in DSH, never an API key. No credentials are stored by this plugin.

## Settings

Change them from **Settings → General** or the plugin's card on the Plugins page. Every field is volatile, so changes apply without a restart.

| Field | Default | Range |
|---|---|---|
| `enabled` | `true` | |
| `routeMode` | `session` | `session` / `fixed` |
| `provider`, `model` | empty | used in `fixed` mode |
| `maxSuggestions` | 3 | 1–5 |
| `typePauseMs` | 700 | 200–5000 |
| `maxOutputTokens` | 220 | 16–2048 |
| `timeoutMs` | 20000 | 1000–120000 |
| `maxMessages` | 10 | 1–50 |
| `maxChars` | 8000 | 500–32000 |

## Privacy and safety

- The endpoint `POST /autocomplete/predict` accepts only the authenticated **owner**, same-origin JSON requests; cross-site requests are refused.
- Only the text of recent user and assistant messages is sent as context, never tool calls or tool output, and it is quoted as untrusted data.
- Predictions never write to the session transcript. At most four predictions run at once; each is bounded by `timeoutMs`.

## Development

`client.js` is generated from `client/*.js`; edit the fragments and run `npm run build:autocomplete` from the repository root. Tests live in `tests/autocomplete/`.
