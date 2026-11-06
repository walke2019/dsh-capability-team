# AIWUK Autocomplete for DSH

Part of [AIWUK Team for DSH](https://github.com/walke2019/dsh-capability-team) ([main README](../../README.md)); usable on its own in any session.

```bash
dsh plugin add @aiwuk/autocomplete
```

Requires DSH >= 0.2.2-rc.1 (below 0.3.0) and Node.js >= 22.

Composer autocomplete for DSH Web (`@aiwuk/autocomplete`, patch id `autocomplete`). The plugin name, description, settings and on-screen text follow the DSH language (Chinese / English).

- **Inline continuation**: pause while typing and a continuation is suggested.
- **Next message**: after the assistant replies, an empty composer suggests what you might ask next.
- A suggestion only fills the composer; it is **never sent automatically**.
- Suggestions stay out of the way of slash commands (`/…`) and references (`@…`), IME composition, and a running turn.

## Desktop vs. phone and tablet

The mode is picked from the device's input, not the screen width, and switches by itself when you attach or detach a keyboard or mouse.

| | Desktop (mouse/keyboard) | Phone / tablet (touch) |
|---|---|---|
| Where | Grey ghost text after the caret | A strip of buttons just above the composer, shown only when there are suggestions |
| Next message | Appears in the empty composer | Appears as buttons in the strip after a reply |
| Continue a draft | Appears after you pause typing | Tap **✦** in the composer's tool row (on screens narrower than 360 px, at the start of the strip) |
| Accept | **Tab** | Tap a suggestion button |
| Other candidates | **Alt+↑/↓** | All candidates are shown; scroll the bar sideways |
| Dismiss | **Esc** | Tap **×** |

Buttons are at least 36 px tall and do not take focus, so the soft keyboard stays open. The strip is laid out in the page above the composer, so it pushes content up instead of covering the workspace, mode or other composer controls, and it takes no space while empty. Turn it off with `mobileBar: false` to get ghost text on touch devices too.

### Multi-agent sessions

Suggestions stand down while the composer is busy: during a running turn, while a confirmation card is docked above the composer (such as a team dispatch plan waiting for approval), and in a read-only teammate view. A request already in flight is cancelled at that moment. Teammate sessions that can be steered (continuable) keep suggestions.

## Across terminals

The same package works on every DSH Web client connected to the instance: the local browser, another computer on the network, and phones opened through the Mothership hub link. The page calls the endpoint relative to itself, so tunnels and path prefixes need no configuration, and settings are stored in the instance (not the browser), so every device shares them.

## Model routing

| `routeMode` | Behavior |
|---|---|
| `session` (default) | Use the provider and model of the session you are typing in. |
| `fixed` | Use the configured `provider` and `model` (both required), e.g. a cheap low-latency model. |

`provider` is the ID of a provider you already configured in DSH, never an API key. No credentials are stored by this plugin.

### Fleet defaults (optional)

A fleet manager can set a default route for many instances by writing these plain values to the DSH credential store (for example as Mothership hub integration settings):

| Credential | Value |
|---|---|
| `AUTOCOMPLETE_PROVIDER` | provider ID, e.g. `my-gateway` |
| `AUTOCOMPLETE_MODEL` | model ID, e.g. `fast-model` |
| `AUTOCOMPLETE_ROUTE_MODE` | optional; `fixed` is implied when provider and model are set, `session` forces session routing |

They are only a default under your own settings: as soon as you pick a route mode or enter a provider or model yourself, your choice wins entirely and the fleet route is ignored. Without these credentials the plugin behaves exactly as described above.

## Settings

Change them from **Settings → General** or the plugin's card on the Plugins page. Every field is volatile, so changes apply without a restart.

| Field | Default | Range |
|---|---|---|
| `enabled` | `true` | |
| `routeMode` | `session` | `session` / `fixed` |
| `provider`, `model` | empty | used in `fixed` mode |
| `maxSuggestions` | 3 | 1–5 |
| `typePauseMs` | 700 | 200–5000 |
| `mobileBar` | `true` | tap bar on touch devices |
| `maxOutputTokens` | 220 | 16–2048 |
| `timeoutMs` | 20000 | 1000–120000 |
| `maxMessages` | 10 | 1–50 |
| `maxChars` | 8000 | 500–32000 |

## Privacy and safety

- The endpoint `POST autocomplete/predict` accepts only the authenticated **owner** and same-origin JSON requests (the forwarded host of a hub tunnel or reverse proxy counts as the origin); cross-site requests are refused.
- Only the text of recent user and assistant messages is sent as context, never tool calls or tool output, and it is quoted as untrusted data.
- Predictions never write to the session transcript. At most four predictions run at once; each is bounded by `timeoutMs`.

## Development

`client.js` is generated from `client/*.js`; edit the fragments and run `npm run build:autocomplete` from the repository root. Tests live in `tests/autocomplete/`.
