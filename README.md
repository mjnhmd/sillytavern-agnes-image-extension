# Agnes Image for SillyTavern

SillyTavern third-party extension that reads the current chat context and uses Agnes Image to generate either a scene image or a character image.

## Install

### Install from URL

In SillyTavern, open `Extensions` -> `Install extension from URL`, then paste:

`https://github.com/mjnhmd/sillytavern-agnes-image-extension`.

### Manual install

Copy this repository into one of these SillyTavern locations:

- Current user: `data/<user-handle>/extensions/sillytavern-agnes-image-extension`
- All users/local development: `public/scripts/extensions/third-party/sillytavern-agnes-image-extension`

Restart SillyTavern or reload the page, then open `Extensions` and find `Agnes Image`.

## Use

1. Open `Extensions`.
2. Enter your Agnes API key.
3. Choose `场景图` or `角色图`.
4. Click `从当前聊天生成`.
5. Preview or download the returned image.

The extension uses the latest chat messages through `SillyTavern.getContext()`. It does not export chat files or send anything until you click the generate button.

## Agnes API

- Endpoint: `https://apihub.agnes-ai.com/v1/images/generations`
- Model: `agnes-image-2.1-flash`
- Auth: `Authorization: Bearer <API key>`

The browser CORS check passed against the current Agnes gateway on 2026-06-18: invalid-token POST returned a readable `401` JSON response instead of a browser CORS block.

## Safety Defaults

Generated prompts force a non-explicit visual target: clothed subjects, no nudity, no sexual act, and no graphic content. This is intentional because roleplay chat can contain private or adult text, while image generation should stay usable and reviewable.

## Troubleshooting

- `请先填写 Agnes API Key`: add the key in the extension panel.
- `Agnes API 401`: the key is invalid or expired.
- `Agnes 没有返回图片 URL`: the provider returned a nonstandard response; open DevTools console for the raw response.
- Browser network error: verify the SillyTavern page can reach `https://apihub.agnes-ai.com`.

## Verify

```bash
node --check index.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```
