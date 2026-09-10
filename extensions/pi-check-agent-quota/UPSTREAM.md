# Upstream and local changes

This extension is based on the MIT-licensed
[`pi-check-agent-quota`](https://github.com/Linen9/pi-check-agent-quota)
package.

- Upstream npm baseline: `pi-check-agent-quota@0.1.2`
- Local version marker before migration: `0.1.2-gpt.2`
- Copied from the active local Pi configuration on 2026-09-10

The local copy differs from npm `0.1.2`. Its main additions are:

- OpenAI Codex/ChatGPT usage-window support.
- An IPv4 request path for the ChatGPT usage endpoint on affected Windows networks.
- Clear success/failure feedback for `/checkaq`.

Do not replace this folder with the public npm package without reviewing the
diff, or those local behaviors will be lost. The original MIT license is kept
in [`LICENSE`](LICENSE).
